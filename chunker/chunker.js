// BABOK Vector Database Chunk Generator
// Conforms to PARSER_SPEC.md — 8 doc_types, sub-chunk per section, spec §4 IDs
// Run: node chunker/chunker.js  (BOOK_PATH read from .env at project root)
'use strict';
const fs = require('fs').promises;
const path = require('path');
const { parse } = require('node-html-parser');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Resolve BOOK_PATH relative to the project root so the result is CWD-independent.
// .env value "../html-book" means one directory above the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BOOK_ROOT = path.resolve(PROJECT_ROOT, process.env.BOOK_PATH || '../html-book');

if (!require('fs').existsSync(BOOK_ROOT)) {
  console.error(`\nError: HTML book directory not found: ${BOOK_ROOT}`);
  console.error(`  BOOK_PATH = "${process.env.BOOK_PATH || '(not set — defaulting to ../html-book)'}"`);
  console.error(`  Update BOOK_PATH in ${path.join(PROJECT_ROOT, '.env')} to the folder that contains chapters/`);
  process.exit(1);
}
// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  chapters: [
    { path: path.join(BOOK_ROOT, 'chapters/03-business-analysis-planning-and-monitoring.html'), num: 3, title: 'Business Analysis Planning and Monitoring' },
    { path: path.join(BOOK_ROOT, 'chapters/04-elicitation-and-collaboration.html'), num: 4, title: 'Elicitation and Collaboration' },
    { path: path.join(BOOK_ROOT, 'chapters/05-requirements-life-cycle-management.html'), num: 5, title: 'Requirements Life Cycle Management' },
    { path: path.join(BOOK_ROOT, 'chapters/06-strategy-analysis.html'), num: 6, title: 'Strategy Analysis' },
    { path: path.join(BOOK_ROOT, 'chapters/07-requirements-analysis-and-design-definition.html'), num: 7, title: 'Requirements Analysis and Design Definition' },
    { path: path.join(BOOK_ROOT, 'chapters/08-solution-evaluation.html'), num: 8, title: 'Solution Evaluation' },
  ],
  techniquesDir: path.join(BOOK_ROOT, 'chapters/techniques/'),
  techniqueTaskMappingFile: path.join(BOOK_ROOT, 'chapters/techniques-to-task-mapping.html'),
  taskRelationshipMappingFile: path.join(BOOK_ROOT, 'chapters/task-relationship-mapping.html'),
  competenciesFile: path.join(BOOK_ROOT, 'chapters/09-underlying-competencies.html'),
  glossaryFile: path.join(BOOK_ROOT, 'chapters/glossary.html'),
  overviewFiles: [
    { path: path.join(BOOK_ROOT, 'chapters/01-introduction.html'), num: 1, title: 'Introduction' },
    { path: path.join(BOOK_ROOT, 'chapters/02-business-analysis-key-concepts.html'), num: 2, title: 'Business Analysis Key Concepts' },
  ],
  perspectives: [
    { path: path.join(BOOK_ROOT, 'chapters/11-1-the-agile-perspective.html'), name: 'Agile' },
    { path: path.join(BOOK_ROOT, 'chapters/11-2-the-business-intelligence-perspective.html'), name: 'Business Intelligence' },
    { path: path.join(BOOK_ROOT, 'chapters/11-3-the-information-technology-perspective.html'), name: 'Information Technology' },
    { path: path.join(BOOK_ROOT, 'chapters/11-4-the-business-architecture-perspective.html'), name: 'Business Architecture' },
    { path: path.join(BOOK_ROOT, 'chapters/11-5-the-business-process-management-perspective.html'), name: 'Business Process Management' },
  ],
  outputFile: path.join(__dirname, 'embeddings-chunks.jsonl'),
  charsPerToken: 4,
};
// Canonical heading map for perspectives (spec §3.6.2 + §5.5)
const PERSPECTIVE_SECTION_MAP = [
  { canonical: 'Change Scope',                              patterns: ['change scope'] },
  { canonical: 'Business Analysis Scope',                   patterns: ['business analysis scope'] },
  { canonical: 'Methodologies, Approaches, and Techniques', patterns: [
    'frameworks, methodologies, and techniques',
    'reference models and techniques',
    'methodologies and approaches',
    'approaches and techniques',
    'methodologies',
  ]},
  { canonical: 'Underlying Competencies',   patterns: ['underlying competencies'] },
  { canonical: 'Impact on Knowledge Areas', patterns: ['impact on knowledge areas'] },
];
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
/** Slug: lowercase, alphanumeric + hyphen only, collapse repeated hyphens (spec §4) */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
/** Load HTML file, apply global DOM cleanup per spec §2.1 */
async function loadHtmlFile(filePath) {
  try {
    const html = await fs.readFile(filePath, 'utf-8');
    const doc = parse(html);
    cleanDom(doc);
    return doc;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`  Skipping missing file: ${path.relative(BOOK_ROOT, filePath)}`);
    } else {
      console.error(`Failed to load ${filePath}:`, err.message);
    }
    return null;
  }
}
/** Remove disallowed nodes: script, style, nav, footer, .arrow (spec §2.1) */
function cleanDom(doc) {
  for (const sel of ['script', 'style', 'nav', 'footer', '.arrow']) {
    doc.querySelectorAll(sel).forEach(el => el.remove());
  }
}
/** Decode entities + collapse whitespace (spec §2.2) */
function getText(el) {
  if (!el) return '';
  return el.text.replace(/\s+/g, ' ').trim();
}
/** Convert UL/OL to bullet lines (spec §2.2) */
function getListText(ulEl) {
  if (!ulEl) return '';
  return ulEl.querySelectorAll('li').map(li => '- ' + getText(li)).join('\n');
}
/** Collect next siblings until a stop tag */
function collectUntil(startEl, stopTags) {
  const result = [];
  let el = startEl;
  while (el) {
    if (stopTags.includes(el.tagName)) break;
    result.push(el);
    el = el.nextElementSibling;
  }
  return result;
}
/**
 * Build content text from a flat element array.
 * Includes H4 labels (needed for Elements sections), paragraphs, lists.
 */
function buildContentText(elements) {
  const parts = [];
  for (const el of elements) {
    if (el.tagName === 'H4') {
      parts.push(getText(el));
    } else if (el.tagName === 'P') {
      parts.push(getText(el));
    } else if (el.tagName === 'UL' || el.tagName === 'OL') {
      parts.push(getListText(el));
    }
  }
  return parts.filter(Boolean).join('\n\n');
}
/** buildContentText variant that also captures H3/H4 headings as content markers (used by overview chunks) */
function buildSectionContent(elements) {
  const parts = [];
  for (const el of elements) {
    if (el.tagName === 'H3' || el.tagName === 'H4') {
      parts.push(getText(el));
    } else if (el.tagName === 'P') {
      parts.push(getText(el));
    } else if (el.tagName === 'UL' || el.tagName === 'OL') {
      parts.push(getListText(el));
    }
  }
  return parts.filter(Boolean).join('\n\n');
}
/** Extract list items as a string array */
function getListItems(ulEl) {
  if (!ulEl) return [];
  return ulEl.querySelectorAll('li').map(li => getText(li));
}
function estimateTokens(text) {
  return Math.ceil((text || '').length / CONFIG.charsPerToken);
}
// ============================================================================
// SHARED SECTION MAP BUILDERS
// ============================================================================
/** Map: H3 heading text → sibling element array (elements between this H3 and next H3) */
function buildH3Map(elements) {
  const map = {};
  let current = null;
  let items = [];
  for (const el of elements) {
    if (el.tagName === 'H3') {
      if (current !== null) map[current] = items;
      current = getText(el);
      items = [];
    } else if (current !== null) {
      items.push(el);
    }
  }
  if (current !== null) map[current] = items;
  return map;
}
/** Map: H4 heading text → sibling element array */
function buildH4Map(elements) {
  const map = {};
  let current = null;
  let items = [];
  for (const el of elements) {
    if (el.tagName === 'H4') {
      if (current !== null) map[current] = items;
      current = getText(el);
      items = [];
    } else if (current !== null) {
      items.push(el);
    }
  }
  if (current !== null) map[current] = items;
  return map;
}
/** Find a [heading, items] entry by case-insensitive keyword */
function findH3Entry(h3Map, keyword) {
  const kw = keyword.toLowerCase();
  for (const [heading, items] of Object.entries(h3Map)) {
    if (heading.toLowerCase().includes(kw)) return [heading, items];
  }
  return null;
}
/** Extract text content for a named H3 subsection */
function extractH3Content(h3Map, subSectionName) {
  const entry = findH3Entry(h3Map, subSectionName);
  return entry ? buildContentText(entry[1]) : '';
}
// ============================================================================
// DOC_TYPE: task  spec §3.1
// One sub-chunk per H3 per task (H2) in KA chapters 3-8.
// chunk_id: task-{section_id}-{slug(title)}-{slug(sub_section)}
// ============================================================================
const TASK_SUBSECTIONS = [
  'Purpose', 'Description', 'Inputs', 'Elements',
  'Guidelines and Tools', 'Techniques', 'Stakeholders', 'Outputs',
];
async function extractTaskChunks(filePath, chapterNum, chapterTitle) {
  console.log(`Reading Knowledge Area: ${chapterTitle}...`);
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];
  const chapter = `${chapterNum}. ${chapterTitle}`;
  const chunks = [];
  doc.querySelectorAll('main > h2').forEach((h2, taskIndex) => {
    const title = getText(h2);
    const sectionId = extractSectionId(h2, chapterNum, taskIndex + 1);
    const taskElements = collectUntil(h2.nextElementSibling, ['H2']);
    const h3Map = buildH3Map(taskElements);
    for (const subSection of TASK_SUBSECTIONS) {
      const content = extractH3Content(h3Map, subSection);
      if (!content) continue;
      const id = `task-${sectionId}-${slugify(title)}-${slugify(subSection)}`;
      chunks.push({
        id,
        doc_type: 'task',
        chapter,
        section_id: sectionId,
        title,
        sub_section: subSection,
        content,
        text: `Task ${sectionId} ${title}\nSection: ${subSection}\nContent: ${content}`,
        source_file: filePath,
        estimated_tokens: estimateTokens(content),
      });
    }
  });
  console.log(`  => ${chunks.length} task sub-chunks from ${chapterTitle}`);
  return chunks;
}
/**
 * Extract section_id with three-tier fallback (spec §3.1.2, §5.2)
 * Primary  : figure article.task span text matching /(\d+\.\d+)\./
 * Fallback A: any figure text with same pattern
 * Fallback B: {chapterNum}.{taskOrdinal}
 */
function extractSectionId(h2, chapterNum, taskOrdinal) {
  let el = h2.nextElementSibling;
  while (el && el.tagName !== 'H2') {
    if (el.tagName === 'FIGURE') {
      const articleEl = el.querySelector('article.task');
      if (articleEl) {
        const span = articleEl.querySelector('span');
        if (span) {
          const m = getText(span).match(/(\d+\.\d+)\./);
          if (m) return m[1];
        }
      }
      const m = getText(el).match(/(\d+\.\d+)\./);
      if (m) return m[1];
    }
    el = el.nextElementSibling;
  }
  return `${chapterNum}.${taskOrdinal}`;
}
// ============================================================================
// DOC_TYPE: technique  spec §3.2
// One sub-chunk per H3; H4 sub-chunks under Usage Considerations.
// chunk_id: technique-{technique_id}-{slug(technique_name)}-{slug(sub_section)}
// ============================================================================
async function extractTechniqueChunks() {
  console.log('Processing Techniques...');
  const chunks = [];
  let files;
  try {
    files = await fs.readdir(CONFIG.techniquesDir);
  } catch (err) {
    console.error('Cannot read techniques dir:', err.message);
    return chunks;
  }
  for (const filename of files.filter(f => f.endsWith('.html'))) {
    const filePath = path.join(CONFIG.techniquesDir, filename);
    const doc = await loadHtmlFile(filePath);
    if (!doc) continue;
    const techniqueId = extractTechniqueId(filename);
    const h2 = doc.querySelector('main > h2');
    const techniqueName = h2 ? getText(h2) : filename.replace(/\.html$/, '');
    const bodyElements = h2 ? collectUntil(h2.nextElementSibling, ['H2']) : [];
    const h3Map = buildH3Map(bodyElements);
    let anyEmitted = false;
    // Regular H3 sub-sections (spec §3.2.1)
    for (const subSection of ['Purpose', 'Description', 'Elements']) {
      const content = extractH3Content(h3Map, subSection);
      if (!content) continue;
      anyEmitted = true;
      const id = `technique-${techniqueId}-${slugify(techniqueName)}-${slugify(subSection)}`;
      chunks.push(buildTechniqueChunk(id, techniqueId, techniqueName, subSection, content, filePath));
    }
    // Usage Considerations: H3-level chunk + H4 Strengths/Limitations sub-chunks (spec §3.2.1)
    const usageEntry = findH3Entry(h3Map, 'usage');
    if (usageEntry) {
      const [, usageItems] = usageEntry;
      const usageContent = buildContentText(usageItems);
      if (usageContent) {
        anyEmitted = true;
        const id = `technique-${techniqueId}-${slugify(techniqueName)}-usage-considerations`;
        chunks.push(buildTechniqueChunk(id, techniqueId, techniqueName, 'Usage Considerations', usageContent, filePath));
      }
      const h4Map = buildH4Map(usageItems);
      for (const [h4Label, h4Items] of Object.entries(h4Map)) {
        const h4Content = buildContentText(h4Items);
        if (!h4Content) continue;
        anyEmitted = true;
        const id = `technique-${techniqueId}-${slugify(techniqueName)}-${slugify(h4Label)}`;
        chunks.push(buildTechniqueChunk(id, techniqueId, techniqueName, h4Label, h4Content, filePath));
      }
    }
    // Fallback: no H3s found — consume first prose as Description (spec §3.2.3)
    if (!anyEmitted) {
      const content = buildContentText(bodyElements);
      if (content) {
        const id = `technique-${techniqueId}-${slugify(techniqueName)}-description`;
        chunks.push(buildTechniqueChunk(id, techniqueId, techniqueName, 'Description', content, filePath));
      }
    }
  }
  console.log(`  => ${chunks.length} technique sub-chunks`);
  return chunks;
}
function extractTechniqueId(filename) {
  const m = filename.match(/^(\d+)-(\d+)-/);
  return m ? `${m[1]}.${m[2]}` : '';
}
function buildTechniqueChunk(id, techniqueId, techniqueName, subSection, content, filePath) {
  return {
    id,
    doc_type: 'technique',
    technique_id: techniqueId,
    technique_name: techniqueName,
    sub_section: subSection,
    content,
    text: `Technique ${techniqueId} ${techniqueName}\nSection: ${subSection}\nContent: ${content}`,
    source_file: filePath,
    estimated_tokens: estimateTokens(content),
  };
}
// ============================================================================
// DOC_TYPE: technique_task_mapping  spec §3.3
// Source: chapters/techniques-to-task-mapping.html
// Structure: h2.no-counter per technique -> strong (KA labels) -> ul (task IDs)
// chunk_id: mapping-tech-{technique_id}-{slug(technique_name)}
// ============================================================================
async function extractTechniqueTaskMappingChunks(filePath) {
  console.log('Processing Technique-to-Task Mapping...');
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];
  const main = doc.querySelector('main');
  if (!main) return [];
  const chunks = [];
  let el = main.firstElementChild;
  while (el) {
    if (el.tagName !== 'H2') { el = el.nextElementSibling; continue; }
    const rawHeading = getText(el);
    // Normalize "10.2." -> "10.2" (spec §3.3.2)
    const idMatch = rawHeading.match(/(10\.?\d+)\.?/);
    if (!idMatch) { el = el.nextElementSibling; continue; }
    const techniqueId = idMatch[1].replace(/\.$/, '');
    const techniqueName = rawHeading.replace(idMatch[0], '').replace(/^[.\s]+/, '').trim();
    const blockElements = collectUntil(el.nextElementSibling, ['H2']);
    // knowledge_areas: strong siblings matching "N. Title" (spec §3.3.2)
    const knowledgeAreas = [];
    for (const node of blockElements) {
      const strongs = (node.tagName === 'STRONG') ? [node] : node.querySelectorAll('strong');
      for (const s of strongs) {
        const t = getText(s);
        if (/^\d+\.\s+/.test(t)) knowledgeAreas.push(t.replace(/^\d+\.\s+/, '').trim());
      }
    }
    // mapped_task_ids: regex /(\d+\.\d+)\./g across all ul li, deduplicated (spec §3.3.2)
    const mappedTaskIds = [];
    const seen = new Set();
    for (const node of blockElements) {
      if (node.tagName !== 'UL') continue;
      for (const li of node.querySelectorAll('li')) {
        for (const m of getText(li).matchAll(/(\d+\.\d+)\./g)) {
          if (!seen.has(m[1])) { seen.add(m[1]); mappedTaskIds.push(m[1]); }
        }
      }
    }
    const kaLine   = knowledgeAreas.length  ? `\nKnowledge Areas: ${knowledgeAreas.join('; ')}` : '';
    const taskLine = mappedTaskIds.length   ? `\nMapped Tasks: ${mappedTaskIds.join(', ')}`      : '';
    const text = `Technique ${techniqueId} ${techniqueName} -- Task Mapping${kaLine}${taskLine}`;
    chunks.push({
      id: `mapping-tech-${techniqueId}-${slugify(techniqueName)}`,
      doc_type: 'technique_task_mapping',
      technique_id: techniqueId,
      technique_name: techniqueName,
      knowledge_areas: knowledgeAreas,
      mapped_task_ids: mappedTaskIds,
      text,
      source_file: filePath,
      estimated_tokens: estimateTokens(text),
    });
    el = el.nextElementSibling;
  }
  console.log(`  => ${chunks.length} technique-to-task mapping chunks`);
  return chunks;
}
// ============================================================================
// DOC_TYPE: task_task_mapping  spec §3.4
// Source: chapters/task-relationship-mapping.html
// Outputs two chunk levels per task:
//   - task-level  : mapping-task-{task_id}-{slug(task_name)}
//   - entity-level: mapping-task-{task_id}-{slug(task_name)}-{slug(mapping_entity)}
// ============================================================================
const MAPPING_ENTITY_DEFS = [
  { label: 'Inputs',                  entityKey: 'inputs',                  slug: 'inputs' },
  { label: 'Task',                    entityKey: 'task',                    slug: 'task' },
  { label: 'Guidelines and Tools',    entityKey: 'guidelines_and_tools',    slug: 'guidelines-and-tools' },
  { label: 'Outputs',                 entityKey: 'outputs',                 slug: 'outputs' },
  { label: 'Tasks Using This Output', entityKey: 'tasks_using_this_output', slug: 'tasks-using-this-output' },
  { label: 'Techniques',              entityKey: 'techniques',              slug: 'techniques' },
];
async function extractTaskTaskMappingChunks(filePath) {
  console.log('Processing Task Relationship Mapping...');
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];
  const main = doc.querySelector('main');
  if (!main) return [];
  const chunks = [];
  let currentChapter = '';
  let taskOrdinalInChapter = 0;
  let el = main.firstElementChild;
  while (el) {
    if (el.tagName === 'H2') {
      currentChapter = getText(el);
      taskOrdinalInChapter = 0;
      el = el.nextElementSibling;
      continue;
    }
    if (el.tagName === 'H3') {
      const h3Text = getText(el);
      taskOrdinalInChapter++;
      // task_id extraction with fallback chain (spec §3.4.2, §5.2a)
      let taskId = null;
      const idMatch = h3Text.match(/(\d+\.\d+)\./);
      if (idMatch) {
        taskId = idMatch[1];
      } else {
        const anchor = el.querySelector('a');
        if (anchor) {
          const m = getText(anchor).match(/(\d+\.\d+)/);
          if (m) taskId = m[1];
        }
      }
      if (!taskId) {
        const chapterMatch = currentChapter.match(/^(\d+)\./);
        if (chapterMatch) taskId = `${chapterMatch[1]}.${taskOrdinalInChapter}`;
      }
      if (!taskId) { el = el.nextElementSibling; continue; }
      const taskName     = h3Text.replace(/^\d+\.\d+\.\s*/, '').trim();
      const anchor       = el.querySelector('a');
      const sourceAnchor = anchor ? (anchor.getAttribute('href') || '') : '';
      const blockElements = collectUntil(el.nextElementSibling, ['H3', 'H2']);
      const entityData    = parseEntitySections(blockElements);
      // Task-level chunk (spec §3.4.1)
      const taskText = buildTaskMappingText(taskId, taskName, currentChapter, entityData);
      chunks.push({
        id: `mapping-task-${taskId}-${slugify(taskName)}`,
        doc_type: 'task_task_mapping',
        task_id: taskId,
        task_name: taskName,
        chapter: currentChapter,
        source_anchor: sourceAnchor,
        inputs: entityData.inputs,
        outputs: entityData.outputs,
        guidelines_and_tools: entityData.guidelines_and_tools,
        downstream_task_ids: entityData.tasks_using_this_output,
        techniques: entityData.techniques,
        text: taskText,
        source_file: filePath,
        estimated_tokens: estimateTokens(taskText),
      });
      // Entity-level chunks (spec §3.4.3)
      for (const def of MAPPING_ENTITY_DEFS) {
        let values;
        if (def.entityKey === 'task') {
          values = [`${taskId}. ${taskName}`];
        } else {
          values = entityData[def.entityKey] || [];
          if (values.length === 0) values = ['Not explicitly listed.']; // spec §5.3a
        }
        const valuesText = values.map(v => `- ${v}`).join('\n');
        const entityText = `Task Mapping ${taskId} ${taskName}\nEntity: ${def.label}\nValues:\n${valuesText}`;
        chunks.push({
          id: `mapping-task-${taskId}-${slugify(taskName)}-${def.slug}`,
          doc_type: 'task_task_mapping',
          task_id: taskId,
          task_name: taskName,
          chapter: currentChapter,
          mapping_entity: def.entityKey,
          mapping_values: values,
          source_anchor: sourceAnchor,
          text: entityText,
          source_file: filePath,
          estimated_tokens: estimateTokens(entityText),
        });
      }
    }
    el = el.nextElementSibling;
  }
  console.log(`  => ${chunks.length} task-to-task mapping chunks`);
  return chunks;
}
/**
 * Parse entity sections from block elements.
 * Structure: UL > LI > STRONG label + nested UL values (spec §3.4.4)
 */
function parseEntitySections(elements) {
  const result = {
    inputs: [], guidelines_and_tools: [], outputs: [],
    tasks_using_this_output: [], techniques: [],
  };
  for (const el of elements) {
    if (el.tagName !== 'UL') continue;
    const directLis = el.childNodes.filter(n => n.tagName === 'LI');
    for (const li of directLis) {
      const strong = li.querySelector('strong');
      if (!strong) continue;
      const label  = getText(strong).toLowerCase().replace(/:$/, '');
      const childUl = li.querySelector('ul');
      const values  = childUl ? getListItems(childUl) : [];
      if      (label.includes('input'))            result.inputs = values;
      else if (label.includes('guideline'))        result.guidelines_and_tools = values;
      else if (label.includes('output'))           result.outputs = values;
      else if (label.includes('tasks using'))      result.tasks_using_this_output = values;
      else if (label.includes('technique'))        result.techniques = values;
    }
  }
  return result;
}
function buildTaskMappingText(taskId, taskName, chapter, d) {
  const lines = [`Task Mapping: ${taskId} ${taskName}`, `Chapter: ${chapter}`];
  if (d.inputs.length)                lines.push(`Inputs: ${d.inputs.join(', ')}`);
  if (d.guidelines_and_tools.length)  lines.push(`Guidelines and Tools: ${d.guidelines_and_tools.join(', ')}`);
  if (d.outputs.length)               lines.push(`Outputs: ${d.outputs.join(', ')}`);
  if (d.tasks_using_this_output.length) lines.push(`Tasks Using This Output: ${d.tasks_using_this_output.join(', ')}`);
  if (d.techniques.length)            lines.push(`Techniques: ${d.techniques.join(', ')}`);
  return lines.join('\n');
}
// ============================================================================
// DOC_TYPE: competency  spec §3.5
// Source: chapters/09-underlying-competencies.html
// H2 = category (9.1-9.6), H3 = competency item, H4 = sub-section
// chunk_id: competency-{slug(category)}-{slug(name)}-{slug(sub_section)}
// ============================================================================
async function extractCompetencyChunks(filePath) {
  console.log('Processing Underlying Competencies...');
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];
  const main = doc.querySelector('main');
  if (!main) return [];
  const chunks = [];
  let categoryCounter = 0;
  let currentCategory = '';
  let el = main.firstElementChild;
  while (el) {
    if (el.tagName === 'H2') {
      categoryCounter++;
      currentCategory = `9.${categoryCounter} ${getText(el)}`;
      el = el.nextElementSibling;
      continue;
    }
    if (el.tagName === 'H3') {
      const competencyName = getText(el);
      const compElements = collectUntil(el.nextElementSibling, ['H3', 'H2']);
      const h4Map = buildH4Map(compElements);
      if (Object.keys(h4Map).length === 0) {
        const content = buildContentText(compElements);
        if (content) {
          const id = `competency-${slugify(currentCategory)}-${slugify(competencyName)}-description`;
          chunks.push(buildCompetencyChunk(id, currentCategory, competencyName, 'Description', content, filePath));
        }
      } else {
        for (const [h4Label, h4Items] of Object.entries(h4Map)) {
          const content = buildContentText(h4Items);
          if (!content) continue;
          // "Description" accepted as valid sub_section (spec §3.5.3)
          const id = `competency-${slugify(currentCategory)}-${slugify(competencyName)}-${slugify(h4Label)}`;
          chunks.push(buildCompetencyChunk(id, currentCategory, competencyName, h4Label, content, filePath));
        }
      }
    }
    el = el.nextElementSibling;
  }
  console.log(`  => ${chunks.length} competency sub-chunks`);
  return chunks;
}
function buildCompetencyChunk(id, category, name, subSection, content, filePath) {
  return {
    id,
    doc_type: 'competency',
    competency_category: category,
    competency_name: name,
    sub_section: subSection,
    content,
    text: `Competency: ${category} - ${name}\nSection: ${subSection}\nContent: ${content}`,
    source_file: filePath,
    estimated_tokens: estimateTokens(content),
  };
}
// ============================================================================
// DOC_TYPE: perspective  spec §3.6
// One chunk per H3; heading variants canonicalized via PERSPECTIVE_SECTION_MAP.
// chunk_id: perspective-{slug(perspective_name)}-{slug(sub_section)}
// ============================================================================
async function extractPerspectiveChunks() {
  console.log('Processing Perspectives...');
  const chunks = [];
  for (const meta of CONFIG.perspectives) {
    const doc = await loadHtmlFile(meta.path);
    if (!doc) continue;
    const h2 = doc.querySelector('h2');
    const rawName = h2 ? getText(h2) : meta.name;
    // Strip leading "The " and trailing " Perspective" (spec §3.6.3)
    const perspectiveName = rawName
      .replace(/^The\s+/i, '')
      .replace(/\s+Perspective$/i, '')
      .trim() || meta.name;
    for (const h3 of doc.querySelectorAll('h3')) {
      const subSection = canonicalizePerspectiveSection(getText(h3));
      const sectionElements = collectUntil(h3.nextElementSibling, ['H3', 'H2']);
      const content = buildContentText(sectionElements);
      if (!content) continue;
      const id = `perspective-${slugify(perspectiveName)}-${slugify(subSection)}`;
      const chunk = {
        id,
        doc_type: 'perspective',
        perspective_name: perspectiveName,
        sub_section: subSection,
        content,
        text: `Perspective: ${perspectiveName}\nSection: ${subSection}\nContent: ${content}`,
        source_file: meta.path,
        estimated_tokens: estimateTokens(content),
      };
      // For Impact section: extract impacted KA names from H4 headings (spec §3.6.3)
      if (subSection === 'Impact on Knowledge Areas') {
        const kas = sectionElements.filter(e => e.tagName === 'H4').map(e => getText(e)).filter(Boolean);
        if (kas.length) chunk.impacted_knowledge_areas = kas;
      }
      chunks.push(chunk);
    }
  }
  console.log(`  => ${chunks.length} perspective chunks`);
  return chunks;
}
/** Map raw H3 heading to canonical section name (spec §3.6.2, §5.5) */
function canonicalizePerspectiveSection(heading) {
  const lower = heading.toLowerCase();
  for (const entry of PERSPECTIVE_SECTION_MAP) {
    for (const pattern of entry.patterns) {
      if (lower.includes(pattern)) return entry.canonical;
    }
  }
  if (/methodolog|approach|framework|reference model|technique/.test(lower)) {
    return 'Methodologies, Approaches, and Techniques';
  }
  return heading;
}
// ============================================================================
// DOC_TYPE: glossary  spec §3.7
// Source: chapters/glossary.html — multiple UL blocks, one LI per term.
// chunk_id: glossary-{slug(term)}
// ============================================================================
async function extractGlossaryChunks(filePath) {
  console.log('Processing Glossary...');
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];
  const main = doc.querySelector('main');
  if (!main) return [];
  const chunks = [];
  main.querySelectorAll('ul > li').forEach(li => {
    const strong = li.querySelector('strong');
    if (!strong) return;
    const term     = getText(strong);
    if (!term) return;
    const fullText = getText(li);
    // Primary: split at first colon (spec §3.7.2)
    let definition = '';
    const colonMatch = fullText.match(/^[^:]+:\s*(.+)$/s);
    if (colonMatch) {
      definition = colonMatch[1].trim();
    } else {
      // Fallback: text after the strong term (spec §3.7.3, §5.4)
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      definition = fullText.replace(new RegExp(`^${escaped}\\s*`), '').trim();
    }
    if (!definition || definition.length < 3) return;
    chunks.push({
      id: `glossary-${slugify(term)}`,
      doc_type: 'glossary',
      term,
      definition,
      text: `Glossary Term: ${term}\nDefinition: ${definition}`,
      source_file: filePath,
      estimated_tokens: estimateTokens(definition),
    });
  });
  console.log(`  => ${chunks.length} glossary chunks`);
  return chunks;
}
// ============================================================================
// DOC_TYPE: overview  spec §3.8
// Source: chapters/01-introduction.html, chapters/02-business-analysis-key-concepts.html
// One chunk per H2 section; H3/H4 headings folded in as content markers.
// chunk_id: overview-{chapter_num}-{slug(section_title)}
// ============================================================================
async function extractOverviewChunks(filePath, chapterNum, chapterTitle) {
  console.log(`Processing Overview: ${chapterTitle}...`);
  const doc = await loadHtmlFile(filePath);
  if (!doc) return [];
  const idNum = String(chapterNum).padStart(2, '0');
  const chapter = `${idNum}. ${chapterTitle}`;
  const chunks = [];
  for (const h2 of doc.querySelectorAll('main > h2')) {
    const sectionTitle = getText(h2);
    const sectionElements = collectUntil(h2.nextElementSibling, ['H2']);
    const content = buildSectionContent(sectionElements);
    if (!content) continue;
    const id = `overview-${idNum}-${slugify(sectionTitle)}`;
    chunks.push({
      id,
      doc_type: 'overview',
      chapter,
      section_title: sectionTitle,
      content,
      text: `BABOK Overview [${chapter}] - ${sectionTitle}\nContent: ${content}`,
      source_file: filePath,
      estimated_tokens: estimateTokens(content),
    });
  }
  console.log(`  => ${chunks.length} overview chunks from ${chapterTitle}`);
  return chunks;
}
// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('Starting BABOK Chunk Extraction per PARSER_SPEC.md...\n');
  const allChunks = [];
  console.log('-- Knowledge Areas (Chapters 3-8) --');
  for (const ch of CONFIG.chapters) {
    allChunks.push(...await extractTaskChunks(ch.path, ch.num, ch.title));
  }
  console.log('\n-- Techniques --');
  allChunks.push(...await extractTechniqueChunks());
  console.log('\n-- Technique-to-Task Mapping --');
  allChunks.push(...await extractTechniqueTaskMappingChunks(CONFIG.techniqueTaskMappingFile));
  console.log('\n-- Task-to-Task Mapping --');
  allChunks.push(...await extractTaskTaskMappingChunks(CONFIG.taskRelationshipMappingFile));
  console.log('\n-- Competencies --');
  allChunks.push(...await extractCompetencyChunks(CONFIG.competenciesFile));
  console.log('\n-- Perspectives --');
  allChunks.push(...await extractPerspectiveChunks());
  console.log('\n-- Glossary --');
  allChunks.push(...await extractGlossaryChunks(CONFIG.glossaryFile));
  console.log('\n-- Overview (Chapters 1-2) --');
  for (const ov of CONFIG.overviewFiles) {
    allChunks.push(...await extractOverviewChunks(ov.path, ov.num, ov.title));
  }
  console.log(`\nWriting ${allChunks.length} chunks to ${CONFIG.outputFile}...`);
  await fs.writeFile(CONFIG.outputFile, allChunks.map(c => JSON.stringify(c)).join('\n'), 'utf-8');
  const byType = {};
  allChunks.forEach(c => { byType[c.doc_type] = (byType[c.doc_type] || 0) + 1; });
  const totalTokens = allChunks.reduce((s, c) => s + (c.estimated_tokens || 0), 0);
  console.log('\nExtraction complete.');
  console.log(`Total chunks : ${allChunks.length}`);
  console.log('By doc_type  :');
  Object.entries(byType).forEach(([t, n]) => console.log(`  ${t}: ${n}`));
  console.log(`Avg tokens   : ${allChunks.length ? Math.round(totalTokens / allChunks.length) : 0}`);
  console.log(`Total tokens : ${totalTokens.toLocaleString()}`);
  console.log('\nNext: node trainer/pinecone-upload.js');
}
main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
