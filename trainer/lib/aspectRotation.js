// Question-angle rotation: picks which aspect (purpose/inputs/outputs/etc.) to focus
// on next for a given chunk type, so GPT doesn't ask the same "what is the purpose"
// question every time.

// Preferred aspect rotation per doc_type (falls back to ASPECT_KEYS_BY_TYPE.task when a type is unrecognized)
const ASPECT_KEYS_BY_TYPE = {
  task: ['purpose', 'elements', 'techniques', 'inputs', 'outputs', 'stakeholders', 'guidelines_and_tools', 'application'],
  technique: ['purpose', 'elements', 'application', 'limitations_strengths'],
  technique_task_mapping: ['technique_usage', 'task_association', 'multi_task_mapping'],
  task_task_mapping: ['inputs', 'outputs', 'upstream_downstream', 'guidelines_and_tools'],
  competency: ['purpose', 'definition', 'effectiveness_measures', 'application'],
  perspective: ['change_scope', 'impact_on_kas', 'methodologies', 'underlying_competencies'],
  glossary: ['definition', 'application'],
  overview: ['baccm_concepts', 'classification_schema', 'key_terms', 'application'],
};

const LEVEL1_STEM_VARIANTS = [
  'Use a situational decision stem (best next action under a realistic constraint).',
  'Use a relationship stem (input-output, producer-consumer, or predecessor-successor relationship).',
  'Use a stakeholder responsibility stem (who is responsible/involved and why).',
  'Use a technique selection stem (which method best fits the context and objective).',
  'Use a distinction stem (differentiate two plausible BABOK concepts by context).',
];

// aspects: the ASPECTS array from config (list of { key, instruction })
function getAspectCandidatesForType(type, aspects) {
  const aspectByKey = new Map(aspects.map((aspect) => [aspect.key, aspect]));
  const preferredKeys = ASPECT_KEYS_BY_TYPE[type] || ASPECT_KEYS_BY_TYPE.task;
  const preferred = preferredKeys.map((k) => aspectByKey.get(k)).filter(Boolean);
  return preferred.length > 0 ? preferred : aspects;
}

module.exports = { ASPECT_KEYS_BY_TYPE, LEVEL1_STEM_VARIANTS, getAspectCandidatesForType };
