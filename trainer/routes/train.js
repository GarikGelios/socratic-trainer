// Training mode: serves the training UI and the /api/train/* endpoints
// (question generation, answer evaluation, session reset).
const express = require('express');
const path = require('path');
const { trainSessions, generateSessionId, createTrainSession } = require('../lib/sessionStore');
const { parseSingleChoice, parseMultiSelect } = require('../lib/questionParsing');
const { detectLeakedWords } = require('../lib/leakageCheck');
const { detectInvertedOptionPairs, detectSelfContradictingExplanations } = require('../lib/consistencyCheck');

const MAX_LEVEL = 7;

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

    const level = (typeof req.body.level === 'number' && req.body.level >= 1 && req.body.level <= MAX_LEVEL)
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

    // Levels 5 and 7 are the "intersecting/complex scenario" tiers — blend in a second chunk's context
    let extraContext = '';
    if ((currentLevel === 5 || currentLevel === 7) && !isPinnedTopic) {
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

    // Levels 1 and 3 are both single-choice tiers — vary their stems the same way.
    const singleChoiceStemDirective = levelConfig.mode === 'single'
      ? `\nStem diversity directive: ${LEVEL1_STEM_VARIANTS[session.stats.asked % LEVEL1_STEM_VARIANTS.length]} Never start every question with \"What is the main goal/purpose of ...\"; vary openings.`
      : '';

    session.currentAspect = aspect.key;
    session.currentAspectType = chunkType;

    const canonicalGuardrail = buildCanonicalGuardrail(chunk, aspect.key);
    const focusInstruction = drillInstruction || aspect.instruction;

    const systemContent = `You are a BABOK® exam trainer. Complexity Level: ${currentLevel}/${MAX_LEVEL} (${levelConfig.name}).\n\n${levelConfig.promptInstruction}`;
    const baseUserContent = `Generate a training question based on this BABOK content:\n\nType: ${getChunkCategory(chunk)}\nTopic: ${getChunkLabel(chunk)}\n\n${referenceText}${canonicalGuardrail}${extraContext}${topicConstraint}\n\nFocus instruction: ${focusInstruction} Do NOT ask about the general purpose or definition if those aspects have already been covered — vary the angle.${singleChoiceStemDirective}`;

    async function generateRaw(extraDirective) {
      const completion = await openai.chat.completions.create({
        model: CONFIG.chatModel,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: baseUserContent + extraDirective },
        ],
        temperature: 0.7,
        max_tokens: levelConfig.maxTokensQ,
      });
      return completion.choices[0].message.content.trim();
    }

    // Parses per the level's mode; falls back to the raw text with no options if parsing fails.
    function parseByMode(raw) {
      if (levelConfig.mode === 'single') {
        const parsed = parseSingleChoice(raw, levelConfig.totalOptions);
        if (parsed) return { question: parsed.question, options: parsed.options, correctAnswer: parsed.correctAnswer, correctAnswers: null, optionExplanations: null };
      } else if (levelConfig.mode === 'multi') {
        const parsed = parseMultiSelect(raw, levelConfig.totalOptions, levelConfig.correctMin);
        if (parsed) return { question: parsed.question, options: parsed.options, correctAnswer: null, correctAnswers: parsed.correctAnswers, optionExplanations: parsed.optionExplanations };
      }
      return { question: raw, options: null, correctAnswer: null, correctAnswers: null, optionExplanations: null };
    }

    // Checks a parsed result for known quality issues (stem leakage, inverted correct options,
    // self-contradicting explanations) and returns human-readable issue descriptions for a retry.
    function collectIssues(parsed) {
      const issues = [];
      if (!parsed.options) return issues; // freetext: nothing to validate

      const correctOptions = levelConfig.mode === 'single'
        ? parsed.options.filter((o) => o.letter === parsed.correctAnswer)
        : (parsed.correctAnswers || []).map((l) => parsed.options.find((o) => o.letter === l)).filter(Boolean);

      const leaked = detectLeakedWords(parsed.question, correctOptions.map((o) => o.text));
      if (leaked.length > 0) {
        issues.push(`The stem repeats the word(s) [${leaked.join(', ')}] from the correct option's own text, making it guessable without BABOK knowledge — rewrite the stem to avoid those words/word-roots.`);
      }

      if (levelConfig.mode === 'multi') {
        detectInvertedOptionPairs(correctOptions).forEach((c) => {
          issues.push(`Two options marked CORRECT assert opposite/inverted roles for ${c.entities.join(', ')} ("${c.textA}" vs "${c.textB}") — only one direction can be true. Adjust the distractors so multiple DISTINCT true aspects exist (e.g. one option about the producing task, one about the consuming task, one about classification) instead of reversing task roles to invent a second correct option.`);
        });

        const optionsWithExpl = parsed.options.map((o) => ({ letter: o.letter, text: o.text, explanation: (parsed.optionExplanations || {})[o.letter] }));
        detectSelfContradictingExplanations(optionsWithExpl).forEach((c) => {
          issues.push(`The explanation for option "${c.text}" contradicts its own option text regarding ${c.entities.join(', ')} — an explanation must directly evaluate the exact statement in its option's text, never state the opposite.`);
        });
      }

      return issues;
    }

    try {
      let rawQuestion = await generateRaw('');
      let result = parseByMode(rawQuestion);

      // Safety net: for option-based levels, retry ONCE if validation finds stem leakage, inverted
      // correct options, or self-contradicting explanations (backstop for the prompt-level rules).
      const issues = collectIssues(result);
      if (issues.length > 0) {
        const retryDirective = `\n\nREVISION REQUIRED: Your draft has the following problem(s):\n- ${issues.join('\n- ')}\nRegenerate the ENTIRE question, fixing these issues while keeping the same topic and, where still factually valid, the same intended correct answer(s).`;
        const retryRaw = await generateRaw(retryDirective);
        const retryResult = parseByMode(retryRaw);
        if (retryResult.options) {
          rawQuestion = retryRaw;
          result = retryResult;
        }
      }

      const { question, options, correctAnswer, correctAnswers, optionExplanations } = result;
      // mode === 'freetext': question stays as the raw trimmed completion text.

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
        multiSelect: levelConfig.mode === 'multi',
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
    const validLetters = new Set((session.currentOptions || []).map((o) => o.letter));

    if (levelConfig.mode === 'single' && session.currentCorrectAnswer) {
      const selected = [...userAnswer.toUpperCase()].find((ch) => validLetters.has(ch)) || null;
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
    } else if (levelConfig.mode === 'multi' && session.currentCorrectAnswers) {
      const correctSet = new Set(session.currentCorrectAnswers);
      const selectedLetters = [...userAnswer.toUpperCase()].filter((ch) => validLetters.has(ch));
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
        const evalSystemPrompt = `You are a BABOK® exam evaluator. Level: ${currentLevel}/${MAX_LEVEL} (${levelConfig.name}).\n\n${levelConfig.evalInstruction}\n\nProvide a structured evaluation in this EXACT format:\n\n## Score\n**Completeness:** X/10\n**Correctness:** X/10\n**Terminology:** X/10\n**Overall:** X/10\n\n## What You Got Right\n- List correct points\n\n## Missing Points\n- List important points missed\n\n## Inaccuracies\n- List incorrect statements (or "None — good job!")\n\n## Improved Answer\nWrite a model answer using proper BABOK terminology.\n\nBe encouraging but honest.`;

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
      if (levelAvg >= TRAINING_CONFIG.autoProgressUpThreshold && currentLevel < MAX_LEVEL) {
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
      multiSelect: levelConfig.mode === 'multi',
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
