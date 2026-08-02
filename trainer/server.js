// BABOK RAG Chat & Training API Server
// Wraps the Pinecone + OpenAI query pipeline as an HTTP API with conversation history
//
// Setup:
//   1. npm install express
//   2. Add PINECONE_API_KEY and OPENAI_API_KEY to .env
//   3. Ensure vectors are uploaded (node trainer/pinecone-upload.js)
//
// Run:
//   node trainer/server.js
//
// Endpoints:
//   POST /api/chat            — send a message, get a RAG-powered answer
//   POST /api/train/question  — get a BABOK training question
//   POST /api/train/evaluate  — evaluate user's answer against BABOK
//   GET  /                    — serves the chat UI
//   GET  /train               — serves the training UI

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  port: 3000,
  indexName: 'ba-training-large-v2',
  // embeddingModel: 'text-embedding-3-small',
  embeddingModel: 'text-embedding-3-large',
  chatModel: 'gpt-4.1-mini',
  topK: 5,
  scoreThreshold: 0.3,
  maxHistoryMessages: 20,  // keep last N messages for context window
};

const SYSTEM_PROMPT = `You are an expert IIBA® CBAP® Examiner and Senior Business Analysis Trainer strictly grounded in the BABOK® Guide v3.
CORE OPERATIONAL DIRECTIVES
1. GROUND TRUTH: Base all questions, scenarios, correct answers, and explanations STRICTLY on BABOK® Guide v3.
2. ANTI-LEAKAGE RULES (CRITICAL):
   - Never use the exact name, label, or word root of the correct answer in the question stem.
   - Never use the primary definition or defining characteristic of the answer as the prompt clue.
3. DISTRACTOR ENGINEERING:
   - All wrong choices must be valid BABOK v3 terms or plausible actions executed in the wrong context or incorrect task order.
   - Never use pseudo-jargon, "All/None of the above", or obviously weak distractors.
4. STRICT THINKING PROCESS:
   Before generating any output or evaluation, you MUST execute an internal reasoning:
  4.1. When GENERATING questions:
    4.1.1. CONCEPT SELECTION: Identify the BABOK v3 Domain, Task, or Technique.
    4.1.2. SCENARIO/STEM DRAFT: Draft a realistic dilemma with explicit constraints (e.g., conflicting stakeholders, budget limits, missing inputs).
    4.1.3. ANSWER SELECTION: Identify the single correct BABOK action/term.
    4.1.4. ANTI-LEAKAGE CHECK: Scan the stem against the correct answer choice. Are there shared word roots or direct definition giveaways? (If yes, rewrite stem).
    4.1.5. DISTRACTOR CONSTRUCTION: Create realistic, same length wrong choices representing common BA mistakes (e.g., wrong sequence, wrong technique context).
    4.1.6. FINAL FORMATTING: Output final payload using strict requested format.
  4.2 When GENERATING answer options:
    4.2.1. LENGTH EQUALITY: All 4 options (A, B, C, D) MUST be approximately equal in word count and character length (±15% variance maximum).
    4.2.2. STRUCTURAL PARALLELISM: All options must share the same grammatical structure (e.g., all start with an action verb, all use noun phrases, or all follow a 'Concept + Purpose' pattern).
    4.2.3. EVEN DETAIL DISTRIBUTION: Do NOT make the correct answer more detailed, qualified, or descriptive than the distractors. If the correct answer includes a condition or explanation, ALL distractors must include a similar level of detail.
    4.2.4. UNIFORM SYNTAX: Avoid monosyllabic or brief distractors paired with a lengthy correct answer. Distractors must look like full, legitimate BABOK definitions or actions.  
  4.3. When EVALUATING student answers:
    4.3.1. INPUT ANALYSIS: Parse student's selected Option (if applicable) AND/OR written explanation.
    4.3.2. ACCURACY CHECK: Compare option/written text against BABOK v3 standards.
    4.3.3. GAP IDENTIFICATION: What correct concepts did they state? What did they confuse or miss?
    4.3.4. FEEDBACK FORMULATION: Structure feedback to praise accuracy, correct misinterpretations, and reference specific BABOK sections.
5. HYBRID EVALUATION RULE (OPTION + FREE TEXT)
When evaluating student responses containing both an Option Choice and Written Explanation:
- Correct Option + Correct Reasoning = Full credit. Reinforce why the reasoning aligns with BABOK.
- Correct Option + Flawed Reasoning = Partial credit. Point out that while the selection was correct, the underlying logic had gaps ("Lucky guess").
- Incorrect Option + Sound Reasoning = Identify where the conceptual misstep occurred that led to the wrong final choice.`;

// ============================================================================
// INITIALIZE SERVICES
// ============================================================================

if (!process.env.PINECONE_API_KEY || !process.env.OPENAI_API_KEY) {
  console.error('❌ Set PINECONE_API_KEY and OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI();
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(CONFIG.indexName);

// Load chunk data once at startup
// Chunks are generated by the chunker module — read from ../chunker/
const chunksPath = path.join(__dirname, '../chunker/embeddings-chunks.jsonl');
const chunkMap = new Map();

if (fs.existsSync(chunksPath)) {
  const lines = fs.readFileSync(chunksPath, 'utf8').split('\n').filter(Boolean);
  lines.forEach(line => {
    const chunk = JSON.parse(line);
    chunkMap.set(chunk.chunk_id, chunk);
  });
  console.log(`📚 Loaded ${chunkMap.size} chunks`);
} else {
  console.error(`❌ Chunks file not found: ${chunksPath}`);
  console.error('   Run: node chunker/chunker.js  (chunker module)');
  process.exit(1);
}

// In-memory conversation sessions (sessionId -> messages[])
const sessions = new Map();

// Build array of chunks suitable for training questions
const trainableChunks = [];
for (const [id, chunk] of chunkMap) {
  const type = chunk.chunk_type;
  // Skip redirect glossary terms ("See X") and very small chunks
  if (chunk.cross_reference?.type === 'redirect') continue;
  if (type === 'glossary_term' && (!chunk.definition || chunk.definition.length < 40)) continue;
  trainableChunks.push(chunk);
}
console.log(`🎓 ${trainableChunks.length} chunks available for training`);

// Complexity levels (Bloom's Taxonomy for BABOK learning)
const COMPLEXITY_LEVELS = {
  1: {
    name: 'Recognition',
    description: 'Multiple choice — pick the correct option',
    promptInstruction: `Generate ONE 4-option multiple-choice question testing recall of a BABOK v3 content under a practical constraint.
CRITICAL RULES FOR QUESTION & OPTION WORDING:
1. NO LEAKAGE: Do NOT use words or word roots from the correct answer option in the question stem.
2. NO DEFINITION GIVEAWAYS: Do NOT describe the defining characteristic or primary function of the correct answer in the question stem.
3. ABSOLUTE LENGTH SYMMETRY: All 4 options MUST be of almost IDENTICAL length (aim for 8–14 words per option). NEVER make the correct option longer, more descriptive, or more detailed than the distractors.
4. GRAMMATICAL PARALLELISM: Every option must begin with the same part of speech (e.g., all starting with an active verb, all starting with a noun phrase, or all starting with a prepostional phrase).
5. PLAUSIBLE DISTRACTORS: Distractors must use real BABOK terminology and be fully realized concepts—do NOT use short, lazy, or one-word distractors.
Output Format EXACTLY as:
QUESTION: [Stem text]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
The length of all options must be the same.
CORRECT: [Letter]
EXPLANATION: [BABOK v3 citation and rationale]`,
    evalInstruction: `Evaluate the student's answer based on both option accuracy and written explanation. Keep response under 4 sentences`,
    maxTokensQ: 350,
    maxTokensE: 400,
  },
  2: {
    name: 'Multi-Select',
    description: 'Select all correct options — 2 or more right answers from a list',
    promptInstruction: `Generate ONE question with 6 options (A–F) where 2 to 4 options are correct. Ask the student to identify all applicable BABOK elements/actions for a specific context.

Output Format EXACTLY as:
QUESTION: [Stem text]
A) [Option]
B) [Option]
C) [Option]
D) [Option]
E) [Option]
F) [Option]
EXPLAIN_A: CORRECT | [1-sentence reason]
EXPLAIN_B: INCORRECT | [1-sentence reason]
EXPLAIN_C: CORRECT | [1-sentence reason]
EXPLAIN_D: INCORRECT | [1-sentence reason]
EXPLAIN_E: INCORRECT | [1-sentence reason]
EXPLAIN_F: INCORRECT | [1-sentence reason]`,
    evalInstruction: '',  // Evaluated locally using stored correct answers and explanations
    maxTokensQ: 700,
    maxTokensE: 500,
  },
  3: {
    name: 'Understanding',
    description: 'One-sentence answer — define or explain the purpose',
    promptInstruction: `Generate ONE clear question asking the student to define a concept, state a purpose, or explain a BABOK relationship in their own words. Expect a 1-2 sentence response. Return ONLY the question text.`,
    evalInstruction: `EVALUATION: Understanding Level
STUDENT ANSWER: {student_text_input}
BABOK CONCEPT: {babok_reference_concept}

Evaluate using ONLY this format:
**Overall Score:** X/10
✅ **Correct Elements:** [Key concepts accurately identified]
⚠️ **Missing/Imprecise:** [Missing or incorrect BABOK concepts]
📖 **BABOK Alignment:** [Concise 1-2 sentence summary of full standard answer]`,
    maxTokensQ: 200,
    maxTokensE: 300,
  },
  4: {
    name: 'Application',
    description: 'Short structured answer — describe elements, list steps, explain usage',
    promptInstruction: `Generate ONE scenario (75–125 words) describing a project situation with conflicting priorities or constraints. Ask: "What should the Business Analyst do NEXT?" or "Which technique is most appropriate?". Include 4 options (A-D).`,
    evalInstruction: `Critique the student's selected action and written logic. Highlight whether their next-step approach aligns with BABOK task sequencing.`,
    maxTokensQ: 200,
    maxTokensE: 1200,
  },
  5: {
    name: 'Analysis',
    description: 'Compare, contrast, and explain relationships between BABOK elements',
    promptInstruction: `Generate ONE scenario involving at least TWO interacting BABOK Knowledge Areas (e.g., RLCM vs. RADD). Ask the student to analyze root causes, missing inputs, or structural trade-offs between techniques. Expect a structured paragraph response or 4-option selection with justification. Return ONLY the scenario prompt.`,
    evalInstruction: `Evaluate the student's analysis based on:
1. Depth of root-cause analysis.
2. Accuracy of connections drawn between BABOK Knowledge Areas/Inputs/Outputs.
3. Correct use of BABOK terminology.
Provide feedback structured into: **Analysis Strengths**, **Misaligned Logic**, and **CBAP Standard Perspective**.`,
    maxTokensQ: 250,
    maxTokensE: 1500,
  },
  6: {
    name: 'Synthesis',
    description: 'Scenario-based — design a BA approach using multiple BABOK concepts',
    promptInstruction: `Generate an enterprise case study (250–400 words) containing:
1. Enterprise context & dynamic constraints (budget, timeline, regulatory).
2. Stakeholder profiles and conflicting goals.
3. Current state vs. desired future state.
Follow the case study with ONE comprehensive question asking the student to propose/recommend a complete BA approach (Knowledge areas, tasks, techniques, governance strategy).
Return ONLY the Case Study and Prompt Text.`,
    evalInstruction: `Grade the response out of 100 based on the following rubric:
- **Strategy Alignment (25%):** Correct identification of business needs and enterprise constraints.
- **Task & Technique Selection (25%):** Appropriateness of selected BABOK techniques.
- **Governance & Life Cycle (25%):** Stakeholder engagement, change management, and traceability planning.
- **Terminological Precision (25%):** Strict alignment with BABOK v3 terminology.
Provide a detailed breakdown with actionable feedback to help the user pass real CBAP case study questions.`,
    maxTokensQ: 350,
    maxTokensE: 2000,
  },
};

// ============================================================================
// CONFIGURABLE CONSTANTS — overridable via trainer-config.json / trainer-prompts.json
// ============================================================================

// Display labels for Pinecone chunk_type values
const CHUNK_CATEGORY_LABELS = {
  task:                   'Knowledge Area Task',
  technique:              'Technique',
  glossary_term:          'Glossary Term',
  key_term:               'Key Term',
  stakeholder_role:       'Stakeholder Role',
  conceptual_framework:   'Core Concept',
  classification_schema:  'Classification',
  conceptual_explanation: 'Concept',
  perspective_section:    'Perspective',
  perspective_impact:     'Perspective Impact',
  perspective_table:      'Perspective Table',
};

// Question-angle rotation — 7 aspects cycled per chunk to prevent repetition
const ASPECTS = [
  { key: 'purpose',      instruction: 'Ask about the PURPOSE or primary objective of this task.' },
  { key: 'elements',     instruction: 'Ask about the KEY ELEMENTS or components described for this task.' },
  { key: 'techniques',   instruction: 'Ask about the TECHNIQUES used or recommended for this task.' },
  { key: 'inputs',       instruction: 'Ask about the INPUTS required by this task and where they come from.' },
  { key: 'outputs',      instruction: 'Ask about the OUTPUTS produced by this task and how they are used.' },
  { key: 'stakeholders', instruction: 'Ask about the STAKEHOLDERS involved in or affected by this task and their roles.' },
  { key: 'application',  instruction: 'Ask about a practical situation where this task would be applied or how it is performed.' },
];

// Auto-progression score thresholds (out of 10)
const TRAINING_CONFIG = {
  autoProgressUpThreshold:   7,
  autoProgressDownThreshold: 4,
};

// User-facing prompt templates — {placeholder} vars substituted by fillTemplate()
const PROMPTS = {
  chatSystemPrompt: SYSTEM_PROMPT,
  topicConstraint: 'Focus your question primarily on "{topic}". You may reference related tasks, techniques, or knowledge areas only when they directly support understanding of this topic — but the question must remain centred on "{topic}"',
  wrongAnswerSystemPrompt: 'You are a BABOK® exam trainer providing concise feedback on a wrong multiple-choice answer.',
  wrongAnswerFeedback: 'The student answered incorrectly.\n\n**Question:** {question}\n\n**Options:**\n{options}\n\n**BABOK Reference:**\n{reference}\n\nProvide feedback in this EXACT format:\n\n## ❌ Incorrect\n\n**Overall:** 0/10\n\n**Why {selected}) is wrong:** [1-2 sentences]\n\n**Why {correct}) is correct:** [1-2 sentences based on BABOK]\n\n**Other options briefly:**\n- [One sentence per remaining option explaining why it is right or wrong]',
  levelSuggestionUp:   'Great progress! Your average at Level {level} is {avg}/10. Ready to move up to Level {next} ({nextName})?',
  levelSuggestionDown: 'Level {level} seems challenging (avg {avg}/10). Consider practicing at Level {prev} ({prevName}) to build a stronger foundation.',
};

// Replace {key} placeholders in a template string with values from a vars object
function fillTemplate(template, vars) {
  return template.replace(/[{](\w+)[}]/g, function(_, k) {
    return vars[k] !== undefined ? String(vars[k]) : '{' + k + '}';
  });
}

// Load JSON config overrides at startup — falls back to hardcoded defaults if files missing
(function loadExternalConfig() {
  var cfgPath  = path.join(__dirname, 'trainer-config.json');
  var prmtPath = path.join(__dirname, 'trainer-prompts.json');

  if (fs.existsSync(cfgPath)) {
    try {
      var ext = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      // Note: CONFIG.indexName change takes effect on next server restart (Pinecone index created at startup)
      if (ext.server)              Object.assign(CONFIG, ext.server);
      if (ext.training)            Object.assign(TRAINING_CONFIG, ext.training);
      if (ext.chunkCategoryLabels) Object.assign(CHUNK_CATEGORY_LABELS, ext.chunkCategoryLabels);
      if (ext.aspects)             { ASPECTS.length = 0; ext.aspects.forEach(function(a) { ASPECTS.push(a); }); }
      if (ext.levels) {
        Object.keys(ext.levels).forEach(function(k) {
          var v = ext.levels[k];
          if (!COMPLEXITY_LEVELS[k]) return;
          ['name','description','maxTokensQ','maxTokensE'].forEach(function(f) {
            if (v[f] !== undefined) COMPLEXITY_LEVELS[k][f] = v[f];
          });
        });
      }
      console.log('[cfg] Loaded trainer-config.json');
    } catch (e) {
      console.warn('[cfg] trainer-config.json error:', e.message);
    }
  }

  if (fs.existsSync(prmtPath)) {
    try {
      var ext2 = JSON.parse(fs.readFileSync(prmtPath, 'utf8'));
      ['chatSystemPrompt','topicConstraint','wrongAnswerSystemPrompt','wrongAnswerFeedback','levelSuggestionUp','levelSuggestionDown']
        .forEach(function(k) { if (ext2[k] !== undefined) PROMPTS[k] = ext2[k]; });
      if (ext2.levels) {
        Object.keys(ext2.levels).forEach(function(k) {
          var v = ext2.levels[k];
          if (!COMPLEXITY_LEVELS[k]) return;
          ['promptInstruction','evalInstruction'].forEach(function(f) {
            if (v[f] !== undefined) COMPLEXITY_LEVELS[k][f] = v[f];
          });
        });
      }
      console.log('[cfg] Loaded trainer-prompts.json');
    } catch (e) {
      console.warn('[cfg] trainer-prompts.json error:', e.message);
    }
  }
})();

// In-memory training sessions (sessionId -> { currentChunk, history, stats, level, levelStats })
const trainSessions = new Map();

// ============================================================================
// RAG PIPELINE
// ============================================================================

async function retrieveContext(question) {
  // Embed the question
  const embeddingResponse = await openai.embeddings.create({
    model: CONFIG.embeddingModel,
    input: question,
  });
  const queryVector = embeddingResponse.data[0].embedding;

  // Query Pinecone
  const results = await index.query({
    vector: queryVector,
    topK: CONFIG.topK,
    includeMetadata: true,
  });

  const matches = (results.matches || []).filter(m => m.score >= CONFIG.scoreThreshold);

  // Build context from full chunk data
  const chunks = matches.map(match => {
    const fullChunk = chunkMap.get(match.id);
    if (!fullChunk) return { id: match.id, score: match.score, text: '(not found)' };

    const parts = [];
    if (fullChunk.purpose) parts.push(`Purpose: ${fullChunk.purpose}`);
    if (fullChunk.description) parts.push(`Description: ${fullChunk.description}`);
    if (fullChunk.definition) parts.push(`${fullChunk.term}: ${fullChunk.definition}`);
    if (fullChunk.explanation) parts.push(`Explanation: ${fullChunk.explanation}`);
    if (fullChunk.content?.overview) parts.push(`Overview: ${fullChunk.content.overview}`);

    if (fullChunk.elements?.length) {
      parts.push('Elements:');
      fullChunk.elements.forEach(e => parts.push(`  - ${e.title}: ${(e.description || '').substring(0, 200)}`));
    }
    if (fullChunk.techniques?.length) {
      parts.push('Techniques: ' + fullChunk.techniques.map(t => t.title || t.name).join(', '));
    }

    const meta = match.metadata || {};
    return {
      id: match.id,
      score: match.score,
      type: meta.chunk_type || fullChunk.chunk_type,
      label: meta.task_title || meta.technique_title || meta.term || meta.role_name || fullChunk.chunk_id,
      text: parts.join('\n'),
    };
  });

  return chunks;
}

function buildContextText(chunks) {
  return chunks.map((c, i) => `[${i + 1}] ${c.id} (score: ${c.score.toFixed(3)})\n${c.text}`).join('\n\n---\n\n');
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.use(express.json());

// Serve chat UI
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'chat.html'));
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const question = message.trim();
  const sid = (typeof sessionId === 'string' && sessionId.length <= 64) ? sessionId : generateSessionId();

  // Get or create session history
  if (!sessions.has(sid)) {
    sessions.set(sid, []);
  }
  const history = sessions.get(sid);

  try {
    // Retrieve relevant chunks
    const chunks = await retrieveContext(question);
    const contextText = buildContextText(chunks);

    // Build messages array with history
    const messages = [{ role: 'system', content: PROMPTS.chatSystemPrompt }];

    // Add conversation history (trimmed to max)
    const recentHistory = history.slice(-CONFIG.maxHistoryMessages);
    messages.push(...recentHistory);

    // Add current question with RAG context
    messages.push({
      role: 'user',
      content: `Context from BABOK Guide:\n\n${contextText}\n\n---\n\nQuestion: ${question}`,
    });

    // Generate answer
    const completion = await openai.chat.completions.create({
      model: CONFIG.chatModel,
      messages,
      temperature: 0.3,
      max_tokens: 1500,
    });

    const answer = completion.choices[0].message.content;

    // Store in history (without the bulky context, just the question)
    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: answer });

    // Trim history if too long
    while (history.length > CONFIG.maxHistoryMessages * 2) {
      history.splice(0, 2);
    }

    res.json({
      sessionId: sid,
      answer,
      sources: chunks.map(c => ({ id: c.id, score: c.score, type: c.type, label: c.label })),
      usage: completion.usage,
    });
  } catch (err) {
    console.error('❌ Chat error:', err.message);
    res.status(500).json({ error: 'Failed to generate answer' });
  }
});

// Reset conversation
app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
  }
  res.json({ ok: true });
});

// ============================================================================
// TRAINING MODE
// ============================================================================

// Serve training UI
app.get('/train', (_req, res) => {
  res.sendFile(path.join(__dirname, 'train.html'));
});

// Extract readable reference text from a chunk (the "correct answer" material)
function extractReferenceText(chunk) {
  const parts = [];
  const type = chunk.chunk_type;

  if (type === 'task') {
    const id = chunk.identification || {};
    if (id.task_title) parts.push(`Task: ${id.task_title} (${id.chapter_title || ''})`);
    if (chunk.purpose) parts.push(`Purpose: ${chunk.purpose}`);
    if (chunk.description) parts.push(`Description: ${chunk.description}`);
    if (chunk.elements?.length) {
      parts.push('Elements:');
      chunk.elements.forEach(e => parts.push(`  - ${e.title}: ${(e.description || '').substring(0, 300)}`));
    }
    if (chunk.techniques?.length) {
      parts.push('Techniques: ' + chunk.techniques.map(t => t.title || t.name).join(', '));
    }
    if (chunk.stakeholders?.length) {
      parts.push('Stakeholders: ' + chunk.stakeholders.map(s => s.role || s).join(', '));
    }
  } else if (type === 'technique') {
    const id = chunk.identification || {};
    if (id.technique_title) parts.push(`Technique: ${id.technique_title}`);
    if (chunk.purpose) parts.push(`Purpose: ${chunk.purpose}`);
    if (chunk.description) parts.push(`Description: ${chunk.description}`);
    if (chunk.elements?.length) {
      parts.push('Elements:');
      chunk.elements.forEach(e => parts.push(`  - ${e.title}: ${(e.description || '').substring(0, 300)}`));
    }
    if (chunk.usage_considerations) {
      if (chunk.usage_considerations.strengths?.length)
        parts.push('Strengths: ' + chunk.usage_considerations.strengths.join('; '));
      if (chunk.usage_considerations.limitations?.length)
        parts.push('Limitations: ' + chunk.usage_considerations.limitations.join('; '));
    }
  } else if (type === 'glossary_term' || type === 'key_term') {
    parts.push(`${chunk.term}: ${chunk.definition}`);
  } else if (type === 'stakeholder_role') {
    parts.push(`${chunk.role_name}: ${chunk.definition}`);
  } else if (type === 'conceptual_framework') {
    parts.push(`${chunk.title}: ${chunk.description}`);
    if (chunk.core_concepts?.length) {
      chunk.core_concepts.forEach(c => parts.push(`  - ${c.concept}: ${c.definition}`));
    }
  } else if (type === 'classification_schema') {
    parts.push(`${chunk.title}: ${chunk.description}`);
    if (chunk.requirement_types?.length) {
      chunk.requirement_types.forEach(t => parts.push(`  - ${t.type_name}: ${t.definition}`));
    }
  } else if (type === 'conceptual_explanation') {
    parts.push(`${chunk.title}`);
    if (chunk.key_principle) parts.push(`Key principle: ${chunk.key_principle}`);
    if (chunk.explanation) parts.push(chunk.explanation);
  } else if (type === 'perspective_section') {
    parts.push(`${chunk.perspective} Perspective - ${chunk.section}`);
    if (chunk.content) parts.push(typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content));
  } else if (type === 'perspective_impact') {
    parts.push(`${chunk.perspective} Perspective - Impact on ${chunk.knowledge_area}`);
    if (chunk.description) parts.push(chunk.description);
  } else if (type === 'perspective_table') {
    parts.push(chunk.table_title || chunk.chunk_id);
    const items = chunk.approaches || chunk.techniques || chunk.methodologies || chunk.reference_models || [];
    items.forEach(item => parts.push(`  - ${item.name}: ${item.description}`));
  } else {
    parts.push(JSON.stringify(chunk).substring(0, 1000));
  }

  return parts.filter(Boolean).join('\n');
}

// Get a human-readable label for the chunk topic
function getChunkLabel(chunk) {
  const type = chunk.chunk_type;
  if (type === 'task') return chunk.identification?.task_title || chunk.chunk_id;
  if (type === 'technique') return chunk.identification?.technique_title || chunk.chunk_id;
  if (type === 'glossary_term' || type === 'key_term') return chunk.term;
  if (type === 'stakeholder_role') return chunk.role_name;
  if (type === 'conceptual_framework' || type === 'classification_schema' || type === 'conceptual_explanation') return chunk.title;
  if (type === 'perspective_section') return `${chunk.perspective} - ${chunk.section}`;
  if (type === 'perspective_impact') return `${chunk.perspective} - ${chunk.knowledge_area}`;
  if (type === 'perspective_table') return chunk.table_title || chunk.chunk_id;
  return chunk.chunk_id;
}

// Category labels for UI
function getChunkCategory(chunk) {
  return CHUNK_CATEGORY_LABELS[chunk.chunk_type] || chunk.chunk_type;
}

// Generate a training question
app.post('/api/train/question', async (req, res) => {
  const { sessionId, topic } = req.body;
  const suggestLevel   = req.body.suggestLevel !== false;  // default true; false = user disabled suggestions
  const suggestThreshold = 3;  // kept as fallback min-questions guard (not exposed in UI, default 3)
  const dedupWindow = (typeof req.body.dedupWindow === 'number' && req.body.dedupWindow >= 1)
    ? Math.floor(req.body.dedupWindow) : 10;
  const sid = (typeof sessionId === 'string' && sessionId.length <= 64) ? sessionId : generateSessionId();

  const level = (typeof req.body.level === 'number' && req.body.level >= 1 && req.body.level <= 6)
    ? req.body.level : null;

  // Get or create training session
  if (!trainSessions.has(sid)) {
    trainSessions.set(sid, {
      history: [],
      stats: { asked: 0, totalScore: 0 },
      suggestLevel: true,
      suggestThreshold: 3,
      dedupWindow: 10,
      level: 1,
      levelStats: { 1: { asked: 0, totalScore: 0 }, 2: { asked: 0, totalScore: 0 }, 3: { asked: 0, totalScore: 0 }, 4: { asked: 0, totalScore: 0 }, 5: { asked: 0, totalScore: 0 }, 6: { asked: 0, totalScore: 0 } },
    });
  }
  const session = trainSessions.get(sid);

  // Apply explicit level change if requested, otherwise use session level
  if (level !== null) session.level = level;
  // Update session settings from request (may change per question)
  session.suggestLevel    = suggestLevel;
  session.suggestThreshold = suggestThreshold;
  session.dedupWindow = dedupWindow;
  const currentLevel = session.level;
  const levelConfig = COMPLEXITY_LEVELS[currentLevel];

  // Pick a chunk: filter by topic if provided, else random
  let pool = trainableChunks;
  if (topic && typeof topic === 'string') {
    const t = topic.toLowerCase();
    if (t.startsWith('chapter:')) {
      const chapterNum = parseInt(t.split(':')[1], 10);
      pool = trainableChunks.filter(c =>
        c.chunk_type === 'task' && c.identification?.chapter_num === chapterNum
      );
    } else if (t.startsWith('task:')) {
      const taskId = t.split(':')[1];
      pool = trainableChunks.filter(c =>
        c.chunk_type === 'task' && c.identification?.task_id === taskId
      );
    } else {
      pool = trainableChunks.filter(c => {
        if (t === 'tasks') return c.chunk_type === 'task';
        if (t === 'techniques') return c.chunk_type === 'technique';
        if (t === 'glossary') return c.chunk_type === 'glossary_term';
        if (t === 'stakeholders') return c.chunk_type === 'stakeholder_role';
        if (t === 'concepts') return ['key_term', 'conceptual_framework', 'classification_schema', 'conceptual_explanation'].includes(c.chunk_type);
        if (t === 'perspectives') return c.chunk_type.startsWith('perspective');
        return true;
      });
    }
    if (pool.length === 0) pool = trainableChunks;
  }

  // For higher levels, prefer richer content (tasks, techniques, perspectives)
  if (currentLevel >= 5) {
    const rich = pool.filter(c => ['task', 'technique', 'perspective_section', 'perspective_impact', 'conceptual_framework', 'classification_schema'].includes(c.chunk_type));
    if (rich.length >= 5) pool = rich;
  }

  // Avoid repeating recently asked chunks
  const recentIds = new Set(session.history.slice(-session.dedupWindow).map(h => h.chunkId));
  const fresh = pool.filter(c => !recentIds.has(c.chunk_id));
  const pickFrom = fresh.length > 0 ? fresh : pool;

  const chunk = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  const referenceText = extractReferenceText(chunk);

  // True when user pinned to a specific task or chapter (prevents off-topic GPT questions)
  const isPinnedTopic = topic && typeof topic === 'string' &&
    (topic.toLowerCase().startsWith('task:') || topic.toLowerCase().startsWith('chapter:'));

  // For level 5 (Synthesis), fetch a second related chunk - suppressed when topic is pinned
  let extraContext = '';
  if (currentLevel === 5 && !isPinnedTopic) {
    const otherPool = trainableChunks.filter(c => c.chunk_id !== chunk.chunk_id && c.chunk_type !== chunk.chunk_type);
    if (otherPool.length > 0) {
      const extra = otherPool[Math.floor(Math.random() * otherPool.length)];
      extraContext = `\n\nAdditional related BABOK content:\nType: ${getChunkCategory(extra)}\nTopic: ${getChunkLabel(extra)}\n${extractReferenceText(extra)}`;
    }
  }

  // When pinned, tell GPT to stay on the selected topic
  const topicConstraint = isPinnedTopic
    ? '\n\nIMPORTANT: ' + fillTemplate(PROMPTS.topicConstraint, { topic: getChunkLabel(chunk) })
    : '';

  try {
    // Ask GPT to formulate a question based on the chunk and complexity level
    const completion = await openai.chat.completions.create({
      model: CONFIG.chatModel,
      messages: [
        {
          role: 'system',
          content: `You are a BABOK® exam trainer. Complexity Level: ${currentLevel}/5 (${levelConfig.name}).\n\n${levelConfig.promptInstruction}`,
        },
        {
          role: 'user',
          content: (() => {
            // Count how many times each aspect has been asked for this chunk in this session
            const chunkHistory = session.history.filter(h => h.chunkId === chunk.chunk_id);
            const aspectCounts = {};
            ASPECTS.forEach(a => { aspectCounts[a.key] = 0; });
            chunkHistory.forEach(h => { if (h.aspect && aspectCounts[h.aspect] !== undefined) aspectCounts[h.aspect]++; });
            // Pick the aspect asked least often (rotate in order on ties)
            const minCount = Math.min(...Object.values(aspectCounts));
            const candidates = ASPECTS.filter(a => aspectCounts[a.key] === minCount);
            const aspect = candidates[chunkHistory.length % candidates.length];
            // Store chosen aspect on session so evaluate can save it to history
            session.currentAspect = aspect.key;
            return `Generate a training question based on this BABOK content:\n\nType: ${getChunkCategory(chunk)}\nTopic: ${getChunkLabel(chunk)}\n\n${referenceText}${extraContext}${topicConstraint}\n\nFocus instruction: ${aspect.instruction} Do NOT ask about the general purpose or definition if those aspects have already been covered — vary the angle.`;
          })(),
        },
      ],
      temperature: 0.7,
      max_tokens: levelConfig.maxTokensQ,
    });

    const rawQuestion = completion.choices[0].message.content.trim();

    // For Level 1, parse out the multiple-choice structure
    // For Level 2, parse out the multi-select structure
    let question = rawQuestion;
    let options = null;
    let correctAnswer = null;
    let correctAnswers = null;
    let optionExplanations = null;
    if (currentLevel === 1) {
      const qMatch = rawQuestion.match(/QUESTION:\s*(.+?)(?=\n[A-D]\))/s);
      const optMatches = [...rawQuestion.matchAll(/([A-D])\)\s*(.+)/g)];
      const cMatch = rawQuestion.match(/CORRECT:\s*([A-D])/);
      if (qMatch && optMatches.length === 4 && cMatch) {
        question = qMatch[1].trim();
        const parsedOptions = optMatches.map(m => ({ letter: m[1], text: m[2].trim() }));
        const correctText = parsedOptions.find(o => o.letter === cMatch[1])?.text;
        // Shuffle options so the correct answer isn't always at the same position
        const letters = ['A', 'B', 'C', 'D'];
        const shuffled = parsedOptions.map(o => o.text);
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        options = shuffled.map((text, i) => ({ letter: letters[i], text }));
        correctAnswer = options.find(o => o.text === correctText)?.letter || cMatch[1];
      }
    } else if (currentLevel === 2) {
      const qMatch = rawQuestion.match(/QUESTION:\s*(.+?)(?=\n[A-F]\))/s);
      const optMatches = [...rawQuestion.matchAll(/^([A-F])\)\s*(.+)$/gm)];
      const explObj = {};
      const derivedCorrect = [];
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach(l => {
        const re = new RegExp('EXPLAIN_' + l + ':\\s*(CORRECT|INCORRECT)\\s*\\|\\s*(.+)');
        const m = rawQuestion.match(re);
        if (m) {
          explObj[l] = m[2].trim();
          if (m[1].toUpperCase() === 'CORRECT') derivedCorrect.push(l);
        }
      });
      // Fallback: also accept legacy CORRECT: line if prefix parsing yields nothing
      const cMatch = rawQuestion.match(/CORRECT:\s*([A-F]+)/);
      if (qMatch && optMatches.length >= 4 && (derivedCorrect.length >= 2 || cMatch)) {
        question = qMatch[1].trim();
        options = optMatches.map(m => ({ letter: m[1], text: m[2].trim() }));
        correctAnswers = derivedCorrect.length >= 2 ? derivedCorrect : cMatch[1].toUpperCase().split('').filter(l => /[A-F]/.test(l));
        optionExplanations = explObj;
      }
    }

    // Store current state in session for evaluation
    session.currentChunk = chunk;
    session.currentQuestion = question;
    session.currentRawQuestion = rawQuestion;
    session.currentOptions = options;
    session.currentCorrectAnswer = correctAnswer;
    session.currentCorrectAnswers = correctAnswers;
    session.currentOptionExplanations = optionExplanations;

    res.json({
      sessionId: sid,
      question,
      options,
      multiSelect: currentLevel === 2,
      level: currentLevel,
      levelName: levelConfig.name,
      levelDescription: levelConfig.description,
      category: getChunkCategory(chunk),
      topic: getChunkLabel(chunk),
      stats: session.stats,
    });
  } catch (err) {
    console.error('❌ Train question error:', err.message);
    res.status(500).json({ error: 'Failed to generate question' });
  }
});

// Evaluate user's answer
app.post('/api/train/evaluate', async (req, res) => {
  const { sessionId, answer } = req.body;

  if (!answer || typeof answer !== 'string' || answer.trim().length === 0) {
    return res.status(400).json({ error: 'Answer is required' });
  }

  const sid = sessionId;
  if (!sid || !trainSessions.has(sid)) {
    return res.status(400).json({ error: 'No active training session. Request a question first.' });
  }

  const session = trainSessions.get(sid);
  if (!session.currentChunk || !session.currentQuestion) {
    return res.status(400).json({ error: 'No pending question. Request a new question first.' });
  }

  const chunk = session.currentChunk;
  const question = session.currentQuestion;
  const referenceText = extractReferenceText(chunk);
  const userAnswer = answer.trim();
  const currentLevel = session.level;
  const levelConfig = COMPLEXITY_LEVELS[currentLevel];

  // For Level 1 multiple-choice: quick evaluation without GPT if options parsed
  let evaluation, overallScore;
  let optionResults = null;
  if (currentLevel === 1 && session.currentCorrectAnswer) {
    const selected = userAnswer.toUpperCase().replace(/[^A-D]/g, '')[0];
    const correct = session.currentCorrectAnswer;
    const correctOption = (session.currentOptions || []).find(o => o.letter === correct);
    if (selected === correct) {
      overallScore = 10;
      evaluation = `## ✅ Correct!\n\n**Overall:** 10/10\n\nGreat job! **${correct})** ${correctOption ? correctOption.text : ''}`;
    } else {
      overallScore = 0;
      // Wrong answer: call GPT to explain all options with BABOK reference
      const optionsSummary = (session.currentOptions || [])
        .map(o => `${o.letter}) ${o.text}${o.letter === correct ? ' [CORRECT]' : ''}${o.letter === selected ? ' [STUDENT SELECTED]' : ''}`)
        .join('\n');
      try {
        const explCompletion = await openai.chat.completions.create({
          model: CONFIG.chatModel,
          messages: [
            {
              role: 'system',
              content: PROMPTS.wrongAnswerSystemPrompt,
            },
            {
              role: 'user',
              content: fillTemplate(PROMPTS.wrongAnswerFeedback, { question, options: optionsSummary, reference: referenceText, selected: selected || '?', correct }),
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        });
        evaluation = explCompletion.choices[0].message.content.trim();
      } catch (_e) {
        evaluation = `## ❌ Incorrect\n\n**Overall:** 0/10\n\nYou selected **${selected || '?'}**, but the correct answer is **${correct})** ${correctOption ? correctOption.text : ''}.\n\n${referenceText.substring(0, 400)}`;
      }
    }
  } else if (currentLevel === 2 && session.currentCorrectAnswers) {
    // Level 2 multi-select: local evaluation using stored correct answers + explanations
    const correctSet = new Set(session.currentCorrectAnswers);
    const selectedLetters = userAnswer.toUpperCase().replace(/[^A-F]/g, '').split('').filter(Boolean);
    const selectedSet = new Set(selectedLetters);

    // Jaccard similarity score
    const TP = selectedLetters.filter(l => correctSet.has(l)).length;
    const FP = selectedLetters.filter(l => !correctSet.has(l)).length;
    const FN = [...correctSet].filter(l => !selectedSet.has(l)).length;
    const union = TP + FP + FN;
    overallScore = union > 0 ? Math.round(TP / union * 10) : 10;

    // Build per-option results used by the UI for colour-coded feedback
    optionResults = (session.currentOptions || []).map(o => ({
      letter: o.letter,
      text: o.text,
      isCorrect: correctSet.has(o.letter),
      wasSelected: selectedSet.has(o.letter),
      explanation: (session.currentOptionExplanations || {})[o.letter] || '',
    }));

    const allCorrect = TP === correctSet.size && FP === 0;
    if (allCorrect) {
      evaluation = `✅ Perfect! You selected all ${TP} correct option${TP > 1 ? 's' : ''} with no wrong selections.`;
    } else {
      const parts = [];
      parts.push(`${TP} of ${correctSet.size} correct option${correctSet.size > 1 ? 's' : ''} selected`);
      if (FP > 0) parts.push(`${FP} incorrect option${FP > 1 ? 's' : ''} selected`);
      if (FN > 0) parts.push(`${FN} correct option${FN > 1 ? 's' : ''} missed`);
      evaluation = parts.join(', ') + '.';
    }
  } else {
    // Levels 3-6: GPT evaluation with level-appropriate depth
    try {
      const evalSystemPrompt = currentLevel === 3
        ? `You are a BABOK® exam evaluator. Level: 3/6 (Understanding).\n\n${levelConfig.evalInstruction}`
        : `You are a BABOK® exam evaluator. Level: ${currentLevel}/6 (${levelConfig.name}).\n\n${levelConfig.evalInstruction}\n\nProvide a structured evaluation in this EXACT format:\n\n## Score\n**Completeness:** X/10\n**Correctness:** X/10\n**Terminology:** X/10\n**Overall:** X/10\n\n## What You Got Right\n- List correct points\n\n## Missing Points\n- List important points missed\n\n## Inaccuracies\n- List incorrect statements (or "None — good job!")\n\n## Improved Answer\nWrite a model answer using proper BABOK terminology.\n\nBe encouraging but honest.`;

      const completion = await openai.chat.completions.create({
        model: CONFIG.chatModel,
        messages: [
          { role: 'system', content: evalSystemPrompt },
          {
            role: 'user',
            content: `**Question:** ${question}\n\n**Student's Answer:**\n${userAnswer}\n\n**BABOK Reference Material:**\n${referenceText}`,
          },
        ],
        temperature: 0.3,
        max_tokens: levelConfig.maxTokensE,
      });

      evaluation = completion.choices[0].message.content;
      const scoreMatch = evaluation.match(/\*\*Overall:\*\*\s*(\d+)\/10/);
      overallScore = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
    } catch (err) {
      console.error('❌ Train evaluate error:', err.message);
      return res.status(500).json({ error: 'Failed to evaluate answer' });
    }
  }

  // Update global stats
  session.stats.asked += 1;
  if (overallScore !== null) {
    session.stats.totalScore += overallScore;
  }

  // Update per-level stats
  const ls = session.levelStats[currentLevel];
  ls.asked += 1;
  if (overallScore !== null) {
    ls.totalScore += overallScore;
  }

  // Store in history
  session.history.push({
    chunkId: chunk.chunk_id,
    question,
    aspect: session.currentAspect || null,
    userAnswer,
    score: overallScore,
    level: currentLevel,
  });

  // Clear current question
  session.currentChunk = null;
  session.currentQuestion = null;
  session.currentOptions = null;
  session.currentCorrectAnswer = null;
  session.currentCorrectAnswers = null;
  session.currentOptionExplanations = null;

  // Auto-progression: suggest level change when enabled (suggestLevel) and score exceeds thresholds
  let suggestedLevel = null;
  let suggestion = null;
  if (session.suggestLevel && ls.asked >= session.suggestThreshold) {
    const levelAvg = ls.totalScore / ls.asked;
    if (levelAvg >= TRAINING_CONFIG.autoProgressUpThreshold && currentLevel < 6) {
      suggestedLevel = currentLevel + 1;
      const next = COMPLEXITY_LEVELS[suggestedLevel];
      suggestion = fillTemplate(PROMPTS.levelSuggestionUp, { level: currentLevel, avg: levelAvg.toFixed(1), next: suggestedLevel, nextName: next.name });
    } else if (levelAvg < TRAINING_CONFIG.autoProgressDownThreshold && currentLevel > 1) {
      suggestedLevel = currentLevel - 1;
      const prev = COMPLEXITY_LEVELS[suggestedLevel];
      suggestion = fillTemplate(PROMPTS.levelSuggestionDown, { level: currentLevel, avg: levelAvg.toFixed(1), prev: suggestedLevel, prevName: prev.name });
    }
  }

  res.json({
    sessionId: sid,
    evaluation,
    score: overallScore,
    level: currentLevel,
    levelName: levelConfig.name,
    suggestedLevel,
    suggestion,
    multiSelect: currentLevel === 2,
    optionResults,
    category: getChunkCategory(chunk),
    topic: getChunkLabel(chunk),
    stats: {
      asked: session.stats.asked,
      averageScore: session.stats.asked > 0 ? (session.stats.totalScore / session.stats.asked).toFixed(1) : null,
      totalScore: session.stats.totalScore,
    },
    levelStats: {
      level: currentLevel,
      asked: ls.asked,
      averageScore: ls.asked > 0 ? (ls.totalScore / ls.asked).toFixed(1) : null,
    },
  });
});

// Reset training session
app.post('/api/train/reset', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && trainSessions.has(sessionId)) {
    trainSessions.delete(sessionId);
  }
  res.json({ ok: true });
});

function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// ============================================================================
// CONFIG API
// ============================================================================

// GET /api/config — current in-memory config (merged defaults + any JSON overrides)
app.get('/api/config', (_req, res) => {
  const levels = {};
  Object.keys(COMPLEXITY_LEVELS).forEach(k => {
    const l = COMPLEXITY_LEVELS[k];
    levels[k] = { name: l.name, description: l.description, maxTokensQ: l.maxTokensQ, maxTokensE: l.maxTokensE };
  });
  res.json({
    server:             { port: CONFIG.port, indexName: CONFIG.indexName, embeddingModel: CONFIG.embeddingModel, chatModel: CONFIG.chatModel, topK: CONFIG.topK, scoreThreshold: CONFIG.scoreThreshold, maxHistoryMessages: CONFIG.maxHistoryMessages },
    training:           { ...TRAINING_CONFIG },
    levels,
    aspects:            ASPECTS.map(a => ({ ...a })),
    chunkCategoryLabels: { ...CHUNK_CATEGORY_LABELS },
  });
});

// POST /api/config — persist updates to trainer-config.json and apply in-memory immediately
app.post('/api/config', (req, res) => {
  const cfgPath = path.join(__dirname, 'trainer-config.json');
  let saved = {};
  try { if (fs.existsSync(cfgPath)) saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}

  const body = req.body;
  if (body.server) {
    saved.server = Object.assign(saved.server || {}, body.server);
    Object.assign(CONFIG, body.server);
  }
  if (body.training) {
    saved.training = Object.assign(saved.training || {}, body.training);
    Object.assign(TRAINING_CONFIG, body.training);
  }
  if (body.chunkCategoryLabels) {
    saved.chunkCategoryLabels = Object.assign(saved.chunkCategoryLabels || {}, body.chunkCategoryLabels);
    Object.assign(CHUNK_CATEGORY_LABELS, body.chunkCategoryLabels);
  }
  if (body.aspects) {
    saved.aspects = body.aspects;
    ASPECTS.length = 0;
    body.aspects.forEach(a => ASPECTS.push(a));
  }
  if (body.levels) {
    saved.levels = saved.levels || {};
    Object.keys(body.levels).forEach(k => {
      if (!COMPLEXITY_LEVELS[k]) return;
      saved.levels[k] = saved.levels[k] || {};
      const v = body.levels[k];
      ['name', 'description', 'maxTokensQ', 'maxTokensE'].forEach(f => {
        if (v[f] !== undefined) { COMPLEXITY_LEVELS[k][f] = v[f]; saved.levels[k][f] = v[f]; }
      });
    });
  }

  try {
    fs.writeFileSync(cfgPath, JSON.stringify(saved, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write trainer-config.json: ' + e.message });
  }
});

// GET /api/prompts — current in-memory prompt templates + per-level instructions
app.get('/api/prompts', (_req, res) => {
  const levels = {};
  Object.keys(COMPLEXITY_LEVELS).forEach(k => {
    levels[k] = { promptInstruction: COMPLEXITY_LEVELS[k].promptInstruction, evalInstruction: COMPLEXITY_LEVELS[k].evalInstruction };
  });
  res.json({ ...PROMPTS, levels });
});

// POST /api/prompts — persist prompt overrides to trainer-prompts.json and apply in-memory immediately
app.post('/api/prompts', (req, res) => {
  const prmtPath = path.join(__dirname, 'trainer-prompts.json');
  let saved = {};
  try { if (fs.existsSync(prmtPath)) saved = JSON.parse(fs.readFileSync(prmtPath, 'utf8')); } catch (_) {}

  const body = req.body;
  const topKeys = ['chatSystemPrompt', 'topicConstraint', 'wrongAnswerSystemPrompt', 'wrongAnswerFeedback', 'levelSuggestionUp', 'levelSuggestionDown'];
  topKeys.forEach(k => {
    if (body[k] !== undefined) { PROMPTS[k] = body[k]; saved[k] = body[k]; }
  });
  if (body.levels) {
    saved.levels = saved.levels || {};
    Object.keys(body.levels).forEach(k => {
      if (!COMPLEXITY_LEVELS[k]) return;
      saved.levels[k] = saved.levels[k] || {};
      const v = body.levels[k];
      ['promptInstruction', 'evalInstruction'].forEach(f => {
        if (v[f] !== undefined) { COMPLEXITY_LEVELS[k][f] = v[f]; saved.levels[k][f] = v[f]; }
      });
    });
  }

  try {
    fs.writeFileSync(prmtPath, JSON.stringify(saved, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write trainer-prompts.json: ' + e.message });
  }
});

// ============================================================================
// START
// ============================================================================

app.listen(CONFIG.port, () => {
  console.log(`\n🚀 BABOK Chat API running at http://localhost:${CONFIG.port}`);
  console.log(`   GET  /          — chat UI`);
  console.log(`   GET  /train     — training mode UI`);
  console.log(`   POST /api/chat  — send { "message": "your question" }`);
  console.log(`   POST /api/train/question — get a training question`);
  console.log(`   POST /api/train/evaluate — evaluate your answer`);
  console.log(`   POST /api/reset — clear conversation { "sessionId": "..." }`);
  console.log(`   GET  /api/config  — read trainer config`);
  console.log(`   POST /api/config  — update trainer config`);
  console.log(`   GET  /api/prompts — read prompt templates`);
  console.log(`   POST /api/prompts — update prompt templates\n`);
});
