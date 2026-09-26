// CBAP specialist exam drills: sharper question framings for six recurring exam
// patterns (BACCM mapping, input/output lineage, guidelines matching, stakeholder
// matrices, multi-task technique mapping, financial analysis). These are NOT
// selectable topics — see lib/topicPools.js. Instead, whenever the chunk already
// picked for a BABOK table-of-contents topic happens to fit a drill's shape, that
// drill's instruction is woven into the question automatically.
const { getChunkType } = require('./chunkAccessors');

const DRILLS = [
  {
    key: 'baccm-mapping',
    label: 'BACCM™ Core Concept Mapping',
    matches: (c) => getChunkType(c) === 'overview' && /core concept model/i.test(c.section_title || ''),
    instruction: 'Focus this question on the BACCM™ (Business Analysis Core Concept Model): Change, Need, Solution, Stakeholder, Value, and Context. Test the student\'s understanding of how these six core concepts relate to and influence one another.',
  },
  {
    key: 'input-output-lineage',
    label: 'Inputs & Outputs Lineage Drill',
    matches: (c) => getChunkType(c) === 'task_task_mapping',
    instruction: 'Focus this question on tracing an artifact\'s lineage: identify which task PRODUCES a given output and which downstream task(s) consume it as an INPUT. Test cross-task input/output relationships, not single-task recall.',
  },
  {
    key: 'guidelines-and-tools',
    label: 'Guidelines & Tools Matching Drill',
    matches: (c) => getChunkType(c) === 'task' && c.sub_section === 'Guidelines and Tools',
    instruction: 'Focus this question on matching a specific Guideline or Tool to the correct BABOK task that uses it as an input to guide or constrain the task\'s execution.',
  },
  {
    key: 'stakeholders',
    label: 'Task-to-Stakeholder Matrix Drill',
    matches: (c) => getChunkType(c) === 'task' && c.sub_section === 'Stakeholders',
    instruction: 'Focus this question on matching stakeholder roles to the specific BABOK task(s) in which they participate or are affected, as if building a task-to-stakeholder responsibility matrix.',
  },
  {
    key: 'technique-mapping',
    label: 'Technique-to-Task Mapping (Multi-Task Uses)',
    matches: (c) => getChunkType(c) === 'technique_task_mapping' && Array.isArray(c.mapped_task_ids) && c.mapped_task_ids.length > 1,
    instruction: 'Focus this question on a technique that is used across MULTIPLE tasks or Knowledge Areas. Test whether the student can identify all applicable tasks/knowledge areas where this technique applies.',
  },
  {
    key: 'financial-calculations',
    label: 'Financial & Quantitative Analysis (ROI, NPV, TCO)',
    matches: (c) => getChunkType(c) === 'technique' && c.technique_name === 'Financial Analysis',
    instruction: 'Generate a quantitative business scenario requiring the student to apply Financial Analysis concepts (e.g., ROI, NPV, Total Cost of Ownership, payback period, cost-benefit comparison). Include realistic numbers where relevant and require the student to interpret or calculate a financial outcome to make a BA recommendation.',
  },
];

// Returns the instruction text of the first drill matching this chunk, or '' when none apply.
function getDrillInstructionForChunk(chunk) {
  const drill = DRILLS.find((d) => d.matches(chunk));
  return drill ? drill.instruction : '';
}

module.exports = { DRILLS, getDrillInstructionForChunk };
