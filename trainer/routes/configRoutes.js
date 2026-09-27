// Settings API consumed by train.html's Settings modal: reads/writes the same
// in-memory config objects that the training routes use, persisting changes to
// trainer-config.json / trainer-prompts.json via config.saveConfigPatch/savePromptsPatch.
const express = require('express');

// deps: { config } — the module exported by trainer/config/index.js
function createConfigRouter({ config }) {
  const router = express.Router();
  const { CONFIG, TRAINING_CONFIG, CHUNK_CATEGORY_LABELS, ASPECTS, COMPLEXITY_LEVELS, PROMPTS, saveConfigPatch, savePromptsPatch } = config;

  router.get('/api/config', (_req, res) => {
    const levels = {};
    Object.keys(COMPLEXITY_LEVELS).forEach((k) => {
      const l = COMPLEXITY_LEVELS[k];
      levels[k] = {
        name: l.name,
        description: l.description,
        mode: l.mode,
        totalOptions: l.totalOptions,
        correctMin: l.correctMin,
        correctMax: l.correctMax,
        maxTokensQ: l.maxTokensQ,
        maxTokensE: l.maxTokensE,
      };
    });
    res.json({
      server: { port: CONFIG.port, indexName: CONFIG.indexName, embeddingModel: CONFIG.embeddingModel, chatModel: CONFIG.chatModel, topK: CONFIG.topK, scoreThreshold: CONFIG.scoreThreshold, maxHistoryMessages: CONFIG.maxHistoryMessages },
      training: { ...TRAINING_CONFIG },
      levels,
      aspects: ASPECTS.map((a) => ({ ...a })),
      chunkCategoryLabels: { ...CHUNK_CATEGORY_LABELS },
    });
  });

  router.post('/api/config', (req, res) => {
    try {
      saveConfigPatch(req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write trainer-config.json: ' + e.message });
    }
  });

  router.get('/api/prompts', (_req, res) => {
    const levels = {};
    Object.keys(COMPLEXITY_LEVELS).forEach((k) => {
      levels[k] = { promptInstruction: COMPLEXITY_LEVELS[k].promptInstruction, evalInstruction: COMPLEXITY_LEVELS[k].evalInstruction };
    });
    res.json({ ...PROMPTS, levels });
  });

  router.post('/api/prompts', (req, res) => {
    try {
      savePromptsPatch(req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write trainer-prompts.json: ' + e.message });
    }
  });

  return router;
}

module.exports = { createConfigRouter };
