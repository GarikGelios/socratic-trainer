// Training mode: serves the training UI and the /api/train/* endpoints
// (question generation, answer evaluation, session reset).
const express = require('express');
const path = require('path');
const { trainSessions, generateSessionId, createTrainSession } = require('../lib/sessionStore');

// deps: { openai, config, chunkMap, trainableChunks, accessors, chunkFormatting, aspectRotation, topicPools, drills, fillTemplate }
function createTrainRouter({ openai, config, trainableChunks, accessors, chunkFormatting, aspectRotation, topicPools, drills, fillTemplate }) {
  const router = express.Router();
  const { CONFIG, COMPLEXITY_LEVELS, TRAINING_CONFIG, PROMPTS, ASPECTS } = config;
  const { getChunkId, getChunkType } = accessors;
  const { extractReferenceText, getChunkLabel, getChunkCategory, buildQuestionContext, buildCanonicalGuardrail } = chunkFormatting;
  const { getAspectCandidatesForType, LEVEL1_STEM_VARIANTS } = aspectRotation;
  const { selectChunkPool } = topicPools;

  router.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'train.html'));
  });

  router.get('/train', (_req, res) => {
    res.redirect('/');
  });

  router.post('/api/train/question', async (req, res) => {
    const { sessionId, topic } = req.body;
    const suggestLevel = req.body.suggestLevel !== false;
    const suggestThreshold = 3;
    const dedupWindow = (typeof req.body.dedupWindow === 'number' && req.body.dedupWindow >= 1)
      ? Math.floor(req.body.dedupWindow) : 10;
    const sid = (typeof sessionId === 'string' && sessionId.length <= 64) ? sessionId : generateSessionId();

    const level = (typeof req.body.level === 'number' && req.body.level >= 1 && req.body.level <= 6)
      ? req.body.level : null;

    if (!trainSessions.has(sid)) {
      trainSessions.set(sid, createTrainSession());
    }
    const session = trainSessions.get(sid);

    if (level !== null) session.level = level;
    session.suggestLevel = suggestLevel;
    session.suggestThreshold = suggestThreshold;
    session.dedupWindow = dedupWindow;
    const currentLevel = session.level;
    const levelConfig = COMPLEXITY_LEVELS[currentLevel];

    // Pick a chunk: filter by topic if provided, else random
    let { pool, relatedContextPool, topicLabelOverride } = selectChunkPool(topic, trainableChunks, getChunkLabel);

    // For higher levels, prefer richer content (tasks, techniques, mappings, perspectives, competencies)
    if (currentLevel >= 5) {
      const richTypes = ['task', 'technique', 'technique_task_mapping', 'task_task_mapping', 'competency', 'perspective', 'overview'];
      const rich = pool.filter((c) => richTypes.includes(getChunkType(c)));

      if (rich.length > 0 && rich.length >= Math.min(5, pool.length)) {
        pool = rich;
        if (relatedContextPool) {
          const richIds = new Set(rich.map((c) => getChunkId(c)).filter(Boolean));
          relatedContextPool = relatedContextPool.filter((c) => richIds.has(getChunkId(c)));
        }
      }
    }

    // Avoid repeating recently asked chunks
    const recentIds = new Set(session.history.slice(-session.dedupWindow).map((h) => h.chunkId));
    const fresh = pool.filter((c) => !recentIds.has(getChunkId(c)));
    const pickFrom = fresh.length > 0 ? fresh : pool;

    const chunk = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    const referenceText = buildQuestionContext(chunk);
    // Woven in automatically when the picked chunk fits a CBAP specialist drill shape (see lib/drills.js)
    const drillInstruction = drills.getDrillInstructionForChunk(chunk);

    const isPinnedTopic = topic && typeof topic === 'string' &&
      /^(task:|chapter:|concept:|competency:|perspective:)/.test(topic.toLowerCase());

    let extraContext = '';
    if (currentLevel === 5 && !isPinnedTopic) {
      const sourcePool = (relatedContextPool && relatedContextPool.length > 0) ? relatedContextPool : pool;
      const otherPool = sourcePool.filter((c) => getChunkId(c) !== getChunkId(chunk) && getChunkType(c) !== getChunkType(chunk));
      if (otherPool.length > 0) {
        const extra = otherPool[Math.floor(Math.random() * otherPool.length)];
        extraContext = `\n\nAdditional related BABOK content:\nType: ${getChunkCategory(extra)}\nTopic: ${getChunkLabel(extra)}\n${extractReferenceText(extra)}`;
      }
    }

    const topicConstraint = isPinnedTopic
      ? '\n\nIMPORTANT: ' + fillTemplate(PROMPTS.topicConstraint, { topic: topicLabelOverride || getChunkLabel(chunk) })
      : '';

    try {
      const completion = await openai.chat.completions.create({
        model: CONFIG.chatModel,
        messages: [
          {
            role: 'system',
            content: `You are a BABOK® exam trainer. Complexity Level: ${currentLevel}/6 (${levelConfig.name}).\n\n${levelConfig.promptInstruction}`,
          },
          {
            role: 'user',
            content: (() => {
              // Rotate question angle by chunk type across session to avoid repetitive "main goal" stems.
              const chunkType = getChunkType(chunk);
              const candidates = getAspectCandidatesForType(chunkType, ASPECTS);
              if (!session.aspectUsageByType) session.aspectUsageByType = {};
              if (!session.aspectUsageByType[chunkType]) session.aspectUsageByType[chunkType] = {};
              const usage = session.aspectUsageByType[chunkType];
              candidates.forEach((a) => {
                if (typeof usage[a.key] !== 'number') usage[a.key] = 0;
              });
              const minCount = Math.min(...candidates.map((a) => usage[a.key]));
              const leastUsed = candidates.filter((a) => usage[a.key] === minCount);
              const aspect = leastUsed[session.stats.asked % leastUsed.length];
              usage[aspect.key] += 1;

              const level1StemDirective = currentLevel === 1
                ? `\nStem diversity directive: ${LEVEL1_STEM_VARIANTS[session.stats.asked % LEVEL1_STEM_VARIANTS.length]} Never start every question with \"What is the main goal/purpose of ...\"; vary openings.`
                : '';

              session.currentAspect = aspect.key;
              session.currentAspectType = chunkType;

              const canonicalGuardrail = buildCanonicalGuardrail(chunk, aspect.key);
              const focusInstruction = drillInstruction || aspect.instruction;

              return `Generate a training question based on this BABOK content:\n\nType: ${getChunkCategory(chunk)}\nTopic: ${getChunkLabel(chunk)}\n\n${referenceText}${canonicalGuardrail}${extraContext}${topicConstraint}\n\nFocus instruction: ${focusInstruction} Do NOT ask about the general purpose or definition if those aspects have already been covered — vary the angle.${level1StemDirective}`;
            })(),
          },
        ],
        temperature: 0.7,
        max_tokens: levelConfig.maxTokensQ,
      });

      const rawQuestion = completion.choices[0].message.content.trim();

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
          const parsedOptions = optMatches.map((m) => ({ letter: m[1], text: m[2].trim() }));
          const correctText = parsedOptions.find((o) => o.letter === cMatch[1])?.text;
          const letters = ['A', 'B', 'C', 'D'];
          const shuffled = parsedOptions.map((o) => o.text);
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          options = shuffled.map((text, i) => ({ letter: letters[i], text }));
          correctAnswer = options.find((o) => o.text === correctText)?.letter || cMatch[1];
        }
      } else if (currentLevel === 2) {
        const qMatch = rawQuestion.match(/QUESTION:\s*(.+?)(?=\n[A-F]\))/s);
        const optMatches = [...rawQuestion.matchAll(/^([A-F])\)\s*(.+)$/gm)];
        const explObj = {};
        const derivedCorrect = [];
        ['A', 'B', 'C', 'D', 'E', 'F'].forEach((l) => {
          const re = new RegExp('EXPLAIN_' + l + ':\\s*(CORRECT|INCORRECT)\\s*\\|\\s*(.+)');
          const m = rawQuestion.match(re);
          if (m) {
            explObj[l] = m[2].trim();
            if (m[1].toUpperCase() === 'CORRECT') derivedCorrect.push(l);
          }
        });
        const cMatch = rawQuestion.match(/CORRECT:\s*([A-F]+)/);
        if (qMatch && optMatches.length >= 4 && (derivedCorrect.length >= 2 || cMatch)) {
          question = qMatch[1].trim();
          options = optMatches.map((m) => ({ letter: m[1], text: m[2].trim() }));
          correctAnswers = derivedCorrect.length >= 2 ? derivedCorrect : cMatch[1].toUpperCase().split('').filter((l) => /[A-F]/.test(l));
          optionExplanations = explObj;
        }
      }

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

  router.post('/api/train/evaluate', async (req, res) => {
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

    let evaluation, overallScore;
    let optionResults = null;
    if (currentLevel === 1 && session.currentCorrectAnswer) {
      const selected = userAnswer.toUpperCase().replace(/[^A-D]/g, '')[0];
      const correct = session.currentCorrectAnswer;
      const correctOption = (session.currentOptions || []).find((o) => o.letter === correct);
      if (selected === correct) {
        overallScore = 10;
        evaluation = `## ✅ Correct!\n\n**Overall:** 10/10\n\nGreat job! **${correct})** ${correctOption ? correctOption.text : ''}`;
      } else {
        overallScore = 0;
        const optionsSummary = (session.currentOptions || [])
          .map((o) => `${o.letter}) ${o.text}${o.letter === correct ? ' [CORRECT]' : ''}${o.letter === selected ? ' [STUDENT SELECTED]' : ''}`)
          .join('\n');
        try {
          const explCompletion = await openai.chat.completions.create({
            model: CONFIG.chatModel,
            messages: [
              { role: 'system', content: PROMPTS.wrongAnswerSystemPrompt },
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
      const correctSet = new Set(session.currentCorrectAnswers);
      const selectedLetters = userAnswer.toUpperCase().replace(/[^A-F]/g, '').split('').filter(Boolean);
      const selectedSet = new Set(selectedLetters);

      const TP = selectedLetters.filter((l) => correctSet.has(l)).length;
      const FP = selectedLetters.filter((l) => !correctSet.has(l)).length;
      const FN = [...correctSet].filter((l) => !selectedSet.has(l)).length;
      const union = TP + FP + FN;
      overallScore = union > 0 ? Math.round(TP / union * 10) : 10;

      optionResults = (session.currentOptions || []).map((o) => ({
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

    session.stats.asked += 1;
    if (overallScore !== null) {
      session.stats.totalScore += overallScore;
    }

    const ls = session.levelStats[currentLevel];
    ls.asked += 1;
    if (overallScore !== null) {
      ls.totalScore += overallScore;
    }

    session.history.push({
      chunkId: getChunkId(chunk),
      question,
      aspect: session.currentAspect || null,
      aspectType: session.currentAspectType || null,
      userAnswer,
      score: overallScore,
      level: currentLevel,
    });

    session.currentChunk = null;
    session.currentQuestion = null;
    session.currentOptions = null;
    session.currentCorrectAnswer = null;
    session.currentCorrectAnswers = null;
    session.currentOptionExplanations = null;
    session.currentAspectType = null;

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

  router.post('/api/train/reset', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId && trainSessions.has(sessionId)) {
      trainSessions.delete(sessionId);
    }
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createTrainRouter };
