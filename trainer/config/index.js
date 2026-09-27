// Single source of truth for server settings, training thresholds, complexity levels,
// aspects, and prompt templates. Loaded from trainer-config.json + trainer-prompts.json —
// no hardcoded defaults live in application code anymore (Option A: JSON-is-truth).
// The exported objects are mutated in place so live edits from the Settings UI
// (/api/config, /api/prompts) are immediately visible to every module that imported them.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'trainer-config.json');
const PROMPTS_PATH = path.join(__dirname, '..', 'trainer-prompts.json');

function readJson(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[cfg] Failed to read ${filePath}:`, e.message);
  }
  return {};
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const cfgFile = readJson(CONFIG_PATH);
const promptsFile = readJson(PROMPTS_PATH);

const CONFIG = Object.assign({}, cfgFile.server);
const TRAINING_CONFIG = Object.assign({}, cfgFile.training);
const CHUNK_CATEGORY_LABELS = Object.assign({}, cfgFile.chunkCategoryLabels);
const ASPECTS = Array.isArray(cfgFile.aspects) ? cfgFile.aspects.slice() : [];

// Merge trainer-config.json (name/description/mode/token limits) with trainer-prompts.json
// (promptInstruction/evalInstruction) into one COMPLEXITY_LEVELS map, keyed 1-7.
// mode is 'single' (radio), 'multi' (checkbox), or 'freetext' (typed answer).
const LEVEL_COUNT = 7;
const COMPLEXITY_LEVELS = {};
for (let n = 1; n <= LEVEL_COUNT; n++) {
  const c = (cfgFile.levels && cfgFile.levels[n]) || {};
  const p = (promptsFile.levels && promptsFile.levels[n]) || {};
  COMPLEXITY_LEVELS[n] = {
    name: c.name,
    description: c.description,
    mode: c.mode,
    totalOptions: c.totalOptions,
    correctMin: c.correctMin,
    correctMax: c.correctMax,
    maxTokensQ: c.maxTokensQ,
    maxTokensE: c.maxTokensE,
    promptInstruction: p.promptInstruction || '',
    evalInstruction: p.evalInstruction || '',
  };
}

const PROMPTS = {
  chatSystemPrompt: promptsFile.chatSystemPrompt || '',
  topicConstraint: promptsFile.topicConstraint || '',
  wrongAnswerSystemPrompt: promptsFile.wrongAnswerSystemPrompt || '',
  wrongAnswerFeedback: promptsFile.wrongAnswerFeedback || '',
  levelSuggestionUp: promptsFile.levelSuggestionUp || '',
  levelSuggestionDown: promptsFile.levelSuggestionDown || '',
};

// Persist a partial update to trainer-config.json and apply it in-memory immediately
function saveConfigPatch(patch) {
  const saved = readJson(CONFIG_PATH);

  if (patch.server) {
    saved.server = Object.assign(saved.server || {}, patch.server);
    Object.assign(CONFIG, patch.server);
  }
  if (patch.training) {
    saved.training = Object.assign(saved.training || {}, patch.training);
    Object.assign(TRAINING_CONFIG, patch.training);
  }
  if (patch.chunkCategoryLabels) {
    saved.chunkCategoryLabels = Object.assign(saved.chunkCategoryLabels || {}, patch.chunkCategoryLabels);
    Object.assign(CHUNK_CATEGORY_LABELS, patch.chunkCategoryLabels);
  }
  if (patch.aspects) {
    saved.aspects = patch.aspects;
    ASPECTS.length = 0;
    patch.aspects.forEach((a) => ASPECTS.push(a));
  }
  if (patch.levels) {
    saved.levels = saved.levels || {};
    Object.keys(patch.levels).forEach((k) => {
      if (!COMPLEXITY_LEVELS[k]) return;
      saved.levels[k] = saved.levels[k] || {};
      const v = patch.levels[k];
      ['name', 'description', 'maxTokensQ', 'maxTokensE'].forEach((f) => {
        if (v[f] !== undefined) { COMPLEXITY_LEVELS[k][f] = v[f]; saved.levels[k][f] = v[f]; }
      });
    });
  }

  writeJson(CONFIG_PATH, saved);
}

// Persist a partial update to trainer-prompts.json and apply it in-memory immediately
function savePromptsPatch(patch) {
  const saved = readJson(PROMPTS_PATH);

  const topKeys = ['chatSystemPrompt', 'topicConstraint', 'wrongAnswerSystemPrompt', 'wrongAnswerFeedback', 'levelSuggestionUp', 'levelSuggestionDown'];
  topKeys.forEach((k) => {
    if (patch[k] !== undefined) { PROMPTS[k] = patch[k]; saved[k] = patch[k]; }
  });
  if (patch.levels) {
    saved.levels = saved.levels || {};
    Object.keys(patch.levels).forEach((k) => {
      if (!COMPLEXITY_LEVELS[k]) return;
      saved.levels[k] = saved.levels[k] || {};
      const v = patch.levels[k];
      ['promptInstruction', 'evalInstruction'].forEach((f) => {
        if (v[f] !== undefined) { COMPLEXITY_LEVELS[k][f] = v[f]; saved.levels[k][f] = v[f]; }
      });
    });
  }

  writeJson(PROMPTS_PATH, saved);
}

module.exports = {
  CONFIG,
  TRAINING_CONFIG,
  CHUNK_CATEGORY_LABELS,
  ASPECTS,
  COMPLEXITY_LEVELS,
  PROMPTS,
  saveConfigPatch,
  savePromptsPatch,
};
