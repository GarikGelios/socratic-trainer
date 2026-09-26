// Resolves a `topic` request param (e.g. "task:plan-...", "chapter:3", "concept:baccm")
// into a pool of trainable chunks. Isolated from the route handler so the topic
// selection rules can be read/tested without spinning up Express.
// CBAP specialist drills (BACCM mapping, input/output lineage, etc.) are not topic
// values here — they are woven into question generation automatically; see lib/drills.js.
const {
  getChunkType,
  getChunkChapterNum,
  slugifyTaskLabel,
  getChunkTaskSelectorKeys,
  getCanonicalTaskId,
  getChunkId,
  extractTaskIdsFromTextList,
} = require('./chunkAccessors');

// competency:<token> topic values -> substring match against chunk.competency_category (e.g. "9.1 Analytical Thinking and Problem Solving")
const COMPETENCY_CATEGORY_KEYWORDS = {
  'analytical-thinking': 'Analytical Thinking',
  'behavioural-characteristics': 'Behavioural Characteristics',
  'business-knowledge': 'Business Knowledge',
  'communication-skills': 'Communication Skills',
  'interaction-skills': 'Interaction Skills',
  'tools-and-technology': 'Tools and Technology',
};

// concept:<token> topic values -> substring match against chunk.section_title within doc_type "overview"
// (BABOK ToC 1.1-1.4 and 2.1-2.5)
const CONCEPT_SECTION_KEYWORDS = {
  'purpose-of-babok':             'Purpose of the BABOK',
  'what-is-business-analysis':    'What is Business Analysis',
  'who-is-a-business-analyst':    'Who is a Business Analyst',
  'structure-of-babok':           'Structure of the BABOK',
  baccm:                          'Core Concept Model',
  'key-terms':                    'Key Terms',
  'requirements-classification':  'Requirements Classification',
  stakeholders:                  'Stakeholders',
  'requirements-and-designs':    'Requirements and Designs',
};

// Returns { pool, relatedContextPool, topicLabelOverride }
function selectChunkPool(topic, trainableChunks, getChunkLabel) {
  let pool = trainableChunks;
  let relatedContextPool = null;
  let topicLabelOverride = null;

  if (!topic || typeof topic !== 'string') {
    return { pool, relatedContextPool, topicLabelOverride };
  }

  const t = topic.toLowerCase();

  if (t.startsWith('chapter:')) {
    const chapterNum = parseInt(t.split(':')[1], 10);
    if (chapterNum === 1 || chapterNum === 2) {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'overview' && getChunkChapterNum(c) === chapterNum);
    } else if (chapterNum === 9) {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'competency');
    } else if (chapterNum === 11) {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'perspective');
    } else {
      // Chapters 3-8 (Knowledge Area tasks): include task-relationship-mapping chunks
      // for the same chapter so input/output lineage questions can surface naturally.
      pool = trainableChunks.filter((c) =>
        (getChunkType(c) === 'task' || getChunkType(c) === 'task_task_mapping') && getChunkChapterNum(c) === chapterNum
      );
    }
  } else if (t.startsWith('concept:')) {
    const token = t.split(':')[1];
    const keyword = CONCEPT_SECTION_KEYWORDS[token];
    pool = trainableChunks.filter((c) => getChunkType(c) === 'overview' && keyword && (c.section_title || '').includes(keyword));
    topicLabelOverride = pool[0] ? pool[0].section_title : token;
  } else if (t.startsWith('competency:')) {
    const token = t.split(':')[1];
    const keyword = COMPETENCY_CATEGORY_KEYWORDS[token];
    pool = trainableChunks.filter((c) => getChunkType(c) === 'competency' && keyword && (c.competency_category || '').includes(keyword));
    topicLabelOverride = pool[0] ? pool[0].competency_category : token;
  } else if (t.startsWith('perspective:')) {
    const token = t.split(':')[1];
    pool = trainableChunks.filter((c) => getChunkType(c) === 'perspective' && slugifyTaskLabel(c.perspective_name) === token);
    topicLabelOverride = pool[0] ? pool[0].perspective_name : token;
  } else if (t.startsWith('task:')) {
    const taskToken = t.split(':')[1];
    const selectedTaskChunks = trainableChunks.filter((c) => getChunkType(c) === 'task' && getChunkTaskSelectorKeys(c).has(taskToken));

    const directMappingChunks = trainableChunks.filter((c) => getChunkType(c) === 'task_task_mapping' && getChunkTaskSelectorKeys(c).has(taskToken));

    const relatedTaskIds = new Set();
    if (/^\d+\.\d+$/.test(taskToken)) relatedTaskIds.add(taskToken);

    selectedTaskChunks.forEach((chunk) => {
      const id = getCanonicalTaskId(chunk);
      if (id) relatedTaskIds.add(String(id));
    });

    directMappingChunks.forEach((chunk) => {
      const baseId = getCanonicalTaskId(chunk);
      if (baseId) relatedTaskIds.add(String(baseId));
      if (Array.isArray(chunk.downstream_task_ids)) {
        chunk.downstream_task_ids.forEach((id) => {
          if (/^\d+\.\d+$/.test(String(id || ''))) relatedTaskIds.add(String(id));
        });
      }
      extractTaskIdsFromTextList(chunk.mapping_values).forEach((id) => relatedTaskIds.add(id));
    });

    const relatedTaskChunks = trainableChunks.filter((c) => getChunkType(c) === 'task' && relatedTaskIds.has(String(getCanonicalTaskId(c) || '')));

    const relatedMappingChunks = trainableChunks.filter((c) => getChunkType(c) === 'task_task_mapping' && relatedTaskIds.has(String(getCanonicalTaskId(c) || '')));

    const poolById = new Map();
    [...selectedTaskChunks, ...directMappingChunks, ...relatedTaskChunks, ...relatedMappingChunks].forEach((chunk) => {
      const id = getChunkId(chunk);
      if (id) poolById.set(id, chunk);
    });

    pool = Array.from(poolById.values());
    relatedContextPool = pool.slice();
    topicLabelOverride = selectedTaskChunks.length > 0 ? getChunkLabel(selectedTaskChunks[0]) : `Task ${taskToken}`;
  } else {
    pool = trainableChunks.filter((c) => {
      const type = getChunkType(c);
      // Include the related mapping doc_type alongside the primary one so lineage/
      // multi-task drills can surface naturally within these broader buckets.
      if (t === 'tasks') return type === 'task' || type === 'task_task_mapping';
      if (t === 'techniques') return type === 'technique' || type === 'technique_task_mapping';
      if (t === 'glossary') return type === 'glossary';
      return true;
    });
  }

  if (pool.length === 0) pool = trainableChunks;

  return { pool, relatedContextPool, topicLabelOverride };
}

module.exports = { COMPETENCY_CATEGORY_KEYWORDS, CONCEPT_SECTION_KEYWORDS, selectChunkPool };
