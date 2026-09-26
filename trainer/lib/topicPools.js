// Resolves a `topic` request param (e.g. "task:plan-...", "chapter:3", "drill:...")
// into a pool of trainable chunks. Isolated from the route handler so the topic
// selection rules can be read/tested without spinning up Express.
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
const CONCEPT_SECTION_KEYWORDS = {
  baccm: 'Core Concept Model',
  'requirements-classification': 'Requirements Classification',
};

// drill:<token> topic values -> CBAP specialist exam drills with a targeted chunk pool + LLM focus instruction
const DRILL_DEFINITIONS = {
  'drill:baccm-mapping': {
    label: 'BACCM™ Core Concept Mapping',
    poolFilter: (c) => getChunkType(c) === 'overview' && /core concept model/i.test(c.section_title || ''),
    instruction: 'Focus this question on the BACCM™ (Business Analysis Core Concept Model): Change, Need, Solution, Stakeholder, Value, and Context. Test the student\'s understanding of how these six core concepts relate to and influence one another.',
  },
  'drill:input-output-lineage': {
    label: 'Inputs & Outputs Lineage Drill',
    poolFilter: (c) => getChunkType(c) === 'task_task_mapping',
    instruction: 'Focus this question on tracing an artifact\'s lineage: identify which task PRODUCES a given output and which downstream task(s) consume it as an INPUT. Test cross-task input/output relationships, not single-task recall.',
  },
  'drill:guidelines-and-tools': {
    label: 'Guidelines & Tools Matching Drill',
    poolFilter: (c) => getChunkType(c) === 'task' && c.sub_section === 'Guidelines and Tools',
    instruction: 'Focus this question on matching a specific Guideline or Tool to the correct BABOK task that uses it as an input to guide or constrain the task\'s execution.',
  },
  'drill:stakeholders': {
    label: 'Task-to-Stakeholder Matrix Drill',
    poolFilter: (c) => getChunkType(c) === 'task' && c.sub_section === 'Stakeholders',
    instruction: 'Focus this question on matching stakeholder roles to the specific BABOK task(s) in which they participate or are affected, as if building a task-to-stakeholder responsibility matrix.',
  },
  'drill:technique-mapping': {
    label: 'Technique-to-Task Mapping (Multi-Task Uses)',
    poolFilter: (c) => getChunkType(c) === 'technique_task_mapping' && Array.isArray(c.mapped_task_ids) && c.mapped_task_ids.length > 1,
    instruction: 'Focus this question on a technique that is used across MULTIPLE tasks or Knowledge Areas. Test whether the student can identify all applicable tasks/knowledge areas where this technique applies.',
  },
  'drill:financial-calculations': {
    label: 'Financial & Quantitative Analysis (ROI, NPV, TCO)',
    poolFilter: (c) => getChunkType(c) === 'technique' && c.technique_name === 'Financial Analysis',
    instruction: 'Generate a quantitative business scenario requiring the student to apply Financial Analysis concepts (e.g., ROI, NPV, Total Cost of Ownership, payback period, cost-benefit comparison). Include realistic numbers where relevant and require the student to interpret or calculate a financial outcome to make a BA recommendation.',
  },
};

// Returns { pool, relatedContextPool, topicLabelOverride, drillInstruction }
function selectChunkPool(topic, trainableChunks, getChunkLabel) {
  let pool = trainableChunks;
  let relatedContextPool = null;
  let topicLabelOverride = null;
  let drillInstruction = '';

  if (!topic || typeof topic !== 'string') {
    return { pool, relatedContextPool, topicLabelOverride, drillInstruction };
  }

  const t = topic.toLowerCase();

  if (t.startsWith('chapter:')) {
    const chapterNum = parseInt(t.split(':')[1], 10);
    if (chapterNum === 1) {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'overview' && getChunkChapterNum(c) === 1);
    } else if (chapterNum === 9) {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'competency');
    } else if (chapterNum === 11) {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'perspective');
    } else {
      pool = trainableChunks.filter((c) => getChunkType(c) === 'task' && getChunkChapterNum(c) === chapterNum);
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
  } else if (t.startsWith('drill:')) {
    const drill = DRILL_DEFINITIONS[t];
    if (drill) {
      pool = trainableChunks.filter(drill.poolFilter);
      drillInstruction = drill.instruction;
      topicLabelOverride = drill.label;
    }
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
      if (t === 'tasks') return type === 'task';
      if (t === 'techniques') return type === 'technique';
      if (t === 'glossary') return type === 'glossary';
      if (t === 'concepts') return type === 'overview';
      return true;
    });
  }

  if (pool.length === 0) pool = trainableChunks;

  return { pool, relatedContextPool, topicLabelOverride, drillInstruction };
}

module.exports = { COMPETENCY_CATEGORY_KEYWORDS, CONCEPT_SECTION_KEYWORDS, DRILL_DEFINITIONS, selectChunkPool };
