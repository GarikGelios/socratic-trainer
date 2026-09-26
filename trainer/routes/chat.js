// Chat mode: serves the chat UI and the RAG-powered /api/chat + /api/reset endpoints.
const express = require('express');
const path = require('path');
const { sessions, generateSessionId } = require('../lib/sessionStore');

// deps: { openai, config: { CONFIG, PROMPTS }, retrieveContext, buildContextText }
function createChatRouter({ openai, config, retrieveContext, buildContextText }) {
  const router = express.Router();
  const { CONFIG, PROMPTS } = config;

  router.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'chat.html'));
  });

  router.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const question = message.trim();
    const sid = (typeof sessionId === 'string' && sessionId.length <= 64) ? sessionId : generateSessionId();

    if (!sessions.has(sid)) {
      sessions.set(sid, []);
    }
    const history = sessions.get(sid);

    try {
      const chunks = await retrieveContext(question);
      const contextText = buildContextText(chunks);

      const messages = [{ role: 'system', content: PROMPTS.chatSystemPrompt }];

      const recentHistory = history.slice(-CONFIG.maxHistoryMessages);
      messages.push(...recentHistory);

      messages.push({
        role: 'user',
        content: `Context from BABOK Guide:\n\n${contextText}\n\n---\n\nQuestion: ${question}`,
      });

      const completion = await openai.chat.completions.create({
        model: CONFIG.chatModel,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
      });

      const answer = completion.choices[0].message.content;

      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: answer });

      while (history.length > CONFIG.maxHistoryMessages * 2) {
        history.splice(0, 2);
      }

      res.json({
        sessionId: sid,
        answer,
        sources: chunks.map((c) => ({ id: c.id, score: c.score, type: c.type, label: c.label })),
        usage: completion.usage,
      });
    } catch (err) {
      console.error('❌ Chat error:', err.message);
      res.status(500).json({ error: 'Failed to generate answer' });
    }
  });

  router.post('/api/reset', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createChatRouter };
