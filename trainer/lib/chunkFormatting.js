// Formats raw BABOK chunks into GPT-ready reference text and UI-facing labels.
// Handles both the old nested schema and the new flat sub-chunk schema from the chunker.
const { getChunkId, getChunkType } = require('./chunkAccessors');

// deps.chunkMap: Map<id, chunk> — used to look up sibling sub-chunks of the same task
// deps.categoryLabels: mutable { doc_type -> display label } object from config
function createChunkFormatting({ chunkMap, categoryLabels }) {
  function extractReferenceText(chunk) {
    const parts = [];
    const type = getChunkType(chunk);

    if (type === 'task') {
      const taskTitle = chunk.identification?.task_title || chunk.title || chunk.task_name;
      const chapterTitle = chunk.identification?.chapter_title || chunk.chapter || '';
      const sectionId = chunk.identification?.task_id || chunk.section_id || '';
      if (taskTitle) parts.push(`Task ${sectionId} ${taskTitle} (${chapterTitle})`.trim());
      if (chunk.sub_section) parts.push(`Section: ${chunk.sub_section}`);
      if (chunk.content) parts.push(chunk.content);
      if (chunk.purpose) parts.push(`Purpose: ${chunk.purpose}`);
      if (chunk.description) parts.push(`Description: ${chunk.description}`);
      if (chunk.elements?.length) {
        parts.push('Elements:');
        chunk.elements.forEach((e) => parts.push(`  - ${e.title}: ${(e.description || '').substring(0, 300)}`));
      }
      if (chunk.techniques?.length) {
        parts.push('Techniques: ' + chunk.techniques.map((t) => t.title || t.name).join(', '));
      }
      if (chunk.stakeholders?.length) {
        parts.push('Stakeholders: ' + chunk.stakeholders.map((s) => s.role || s).join(', '));
      }
    } else if (type === 'technique') {
      const techniqueTitle = chunk.identification?.technique_title || chunk.technique_name;
      const techniqueId = chunk.identification?.technique_num || chunk.technique_id || '';
      if (techniqueTitle) parts.push(`Technique ${techniqueId} ${techniqueTitle}`.trim());
      if (chunk.sub_section) parts.push(`Section: ${chunk.sub_section}`);
      if (chunk.content) parts.push(chunk.content);
      if (chunk.purpose) parts.push(`Purpose: ${chunk.purpose}`);
      if (chunk.description) parts.push(`Description: ${chunk.description}`);
      if (chunk.elements?.length) {
        parts.push('Elements:');
        chunk.elements.forEach((e) => parts.push(`  - ${e.title}: ${(e.description || '').substring(0, 300)}`));
      }
      if (chunk.usage_considerations) {
        if (chunk.usage_considerations.strengths?.length)
          parts.push('Strengths: ' + chunk.usage_considerations.strengths.join('; '));
        if (chunk.usage_considerations.limitations?.length)
          parts.push('Limitations: ' + chunk.usage_considerations.limitations.join('; '));
      }
    } else if (type === 'competency') {
      if (chunk.competency_category || chunk.competency_name)
        parts.push(`Competency: ${chunk.competency_category || ''} - ${chunk.competency_name || ''}`.trim());
      if (chunk.sub_section) parts.push(`Section: ${chunk.sub_section}`);
      if (chunk.content) parts.push(chunk.content);
    } else if (type === 'technique_task_mapping') {
      if (chunk.technique_name) parts.push(`Technique: ${chunk.technique_id || ''} ${chunk.technique_name}`.trim());
      if (chunk.knowledge_areas?.length) parts.push('Knowledge Areas: ' + chunk.knowledge_areas.join('; '));
      if (chunk.mapped_task_ids?.length) parts.push('Mapped Tasks: ' + chunk.mapped_task_ids.join(', '));
      if (chunk.content) parts.push(chunk.content);
    } else if (type === 'glossary_term' || type === 'key_term' || type === 'glossary') {
      parts.push(`${chunk.term}: ${chunk.definition}`);
    } else if (type === 'stakeholder_role') {
      parts.push(`${chunk.role_name}: ${chunk.definition}`);
    } else if (type === 'conceptual_framework') {
      parts.push(`${chunk.title}: ${chunk.description}`);
      if (chunk.core_concepts?.length) {
        chunk.core_concepts.forEach((c) => parts.push(`  - ${c.concept}: ${c.definition}`));
      }
    } else if (type === 'classification_schema') {
      parts.push(`${chunk.title}: ${chunk.description}`);
      if (chunk.requirement_types?.length) {
        chunk.requirement_types.forEach((t) => parts.push(`  - ${t.type_name}: ${t.definition}`));
      }
    } else if (type === 'conceptual_explanation') {
      parts.push(`${chunk.title}`);
      if (chunk.key_principle) parts.push(`Key principle: ${chunk.key_principle}`);
      if (chunk.explanation) parts.push(chunk.explanation);
    } else if (type === 'perspective_section' || type === 'perspective') {
      const pName = chunk.perspective || chunk.perspective_name || 'Perspective';
      const pSec = chunk.sub_section || chunk.section || '';
      parts.push(pSec ? `${pName} - ${pSec}` : pName);
      if (chunk.content) parts.push(typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content));
    } else if (type === 'perspective_impact') {
      parts.push(`${chunk.perspective} Perspective - Impact on ${chunk.knowledge_area}`);
      if (chunk.description) parts.push(chunk.description);
      if (chunk.content) parts.push(chunk.content);
    } else if (type === 'perspective_table') {
      parts.push(chunk.table_title || getChunkId(chunk));
      const items = chunk.approaches || chunk.techniques || chunk.methodologies || chunk.reference_models || [];
      items.forEach((item) => parts.push(`  - ${item.name}: ${item.description}`));
    } else if (type === 'task_task_mapping') {
      if (chunk.task_id || chunk.task_name) parts.push(`Task Mapping: ${chunk.task_id || ''} ${chunk.task_name || ''}`.trim());
      if (chunk.mapping_entity) parts.push(`Entity: ${chunk.mapping_entity}`);
      if (Array.isArray(chunk.mapping_values) && chunk.mapping_values.length) {
        parts.push('Values:');
        chunk.mapping_values.forEach((v) => parts.push(`  - ${v}`));
      }
      if (Array.isArray(chunk.downstream_task_ids) && chunk.downstream_task_ids.length) {
        parts.push('Related Tasks: ' + chunk.downstream_task_ids.join(', '));
      }
    } else if (type === 'overview' || type === 'core_concept') {
      if (chunk.chapter || chunk.section_title) parts.push(`${chunk.chapter || 'Overview'} - ${chunk.section_title || 'Section'}`);
      if (chunk.content) parts.push(chunk.content);
    } else {
      parts.push(chunk.text || JSON.stringify(chunk).substring(0, 1000));
    }

    return parts.filter(Boolean).join('\n');
  }

  function getChunkLabel(chunk) {
    const type = getChunkType(chunk);
    if (type === 'task') {
      const base = chunk.identification?.task_title || chunk.title || chunk.task_name || getChunkId(chunk);
      return chunk.sub_section ? `${base} — ${chunk.sub_section}` : base;
    }
    if (type === 'technique') {
      const base = chunk.identification?.technique_title || chunk.technique_name || getChunkId(chunk);
      return chunk.sub_section ? `${base} — ${chunk.sub_section}` : base;
    }
    if (type === 'competency') return chunk.competency_name || chunk.competency_category || getChunkId(chunk);
    if (type === 'technique_task_mapping') return chunk.technique_name || getChunkId(chunk);
    if (type === 'glossary_term' || type === 'key_term' || type === 'glossary') return chunk.term || getChunkId(chunk);
    if (type === 'stakeholder_role') return chunk.role_name;
    if (type === 'conceptual_framework' || type === 'classification_schema' || type === 'conceptual_explanation') return chunk.title;
    if (type === 'overview' || type === 'core_concept') return chunk.section_title || chunk.title || getChunkId(chunk);
    if (type === 'task_task_mapping') return chunk.task_name || chunk.task_id || getChunkId(chunk);
    if (type === 'perspective_section') return `${chunk.perspective} - ${chunk.section}`;
    if (type === 'perspective_impact') return `${chunk.perspective} - ${chunk.knowledge_area}`;
    if (type === 'perspective_table' || type === 'perspective') {
      const base = chunk.perspective_name || chunk.table_title || getChunkId(chunk);
      return chunk.sub_section ? `${base} — ${chunk.sub_section}` : base;
    }
    return getChunkId(chunk);
  }

  function getChunkCategory(chunk) {
    const type = getChunkType(chunk);
    return categoryLabels[type] || type || 'Unknown';
  }

  // Aggregates all sub-section chunks for the same task (Purpose/Inputs/Outputs/etc.)
  // so GPT sees the complete task context in one block instead of a single sub-section.
  function buildQuestionContext(chunk) {
    const type = getChunkType(chunk);
    const sectionId = chunk.section_id;

    if (type !== 'task' || !sectionId) return extractReferenceText(chunk);

    const SECTION_ORDER = ['Purpose', 'Description', 'Inputs', 'Elements', 'Guidelines and Tools', 'Techniques', 'Stakeholders', 'Outputs'];

    const siblings = [];
    for (const [, c] of chunkMap) {
      if (getChunkType(c) === 'task' && c.section_id === sectionId) siblings.push(c);
    }

    if (siblings.length <= 1) return extractReferenceText(chunk);

    siblings.sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a.sub_section);
      const bi = SECTION_ORDER.indexOf(b.sub_section);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    const taskTitle = chunk.title || chunk.task_name || '';
    const chapter = chunk.chapter || '';
    const lines = [`Task ${sectionId} ${taskTitle} (${chapter})`.trim()];
    for (const s of siblings) {
      if (s.sub_section && s.content) lines.push(`\n${s.sub_section}:\n${s.content}`);
    }
    return lines.join('\n');
  }

  // Injects canonical BABOK values for structured aspects (outputs/inputs/stakeholders/
  // guidelines) to ground the GPT question and prevent hallucinated distractors.
  function buildCanonicalGuardrail(chunk, aspect) {
    const aspectToSection = {
      outputs: 'Outputs',
      inputs: 'Inputs',
      stakeholders: 'Stakeholders',
      guidelines_and_tools: 'Guidelines and Tools',
    };
    const subSectionName = aspectToSection[aspect];
    if (!subSectionName) return '';

    const sectionId = chunk.section_id;
    if (!sectionId) return '';

    let targetChunk = null;
    if (chunk.sub_section === subSectionName) {
      targetChunk = chunk;
    } else {
      for (const [, c] of chunkMap) {
        if (getChunkType(c) === 'task' && c.section_id === sectionId && c.sub_section === subSectionName) {
          targetChunk = c;
          break;
        }
      }
    }

    if (!targetChunk?.content) return '';
    return `\n\n⚠️  CANONICAL ${subSectionName.toUpperCase()} — use ONLY these values as correct options; distractors must be plausible BABOK terms from OTHER tasks, not fabricated:\n${targetChunk.content}`;
  }

  return { extractReferenceText, getChunkLabel, getChunkCategory, buildQuestionContext, buildCanonicalGuardrail };
}

module.exports = { createChunkFormatting };
