// Parses the raw GPT completion text for single-choice and multi-select question
// levels into structured { question, options, ... } objects. Shared across all
// levels that use the same "mode" (single/multi) regardless of option count, so
// the 7-tier difficulty matrix (config/index.js) can vary totalOptions/correctMin
// per level without duplicating parsing logic.

function buildLetters(n) {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
}

// Levels 1 and 3: exactly one correct option out of `totalOptions`.
// Shuffles option order so the correct answer isn't always in the same position.
function parseSingleChoice(rawQuestion, totalOptions) {
  const letters = buildLetters(totalOptions);
  const lastLetter = letters[letters.length - 1];
  const qMatch = rawQuestion.match(new RegExp(`QUESTION:\\s*(.+?)(?=\\n[A-${lastLetter}]\\))`, 's'));
  const optMatches = [...rawQuestion.matchAll(new RegExp(`^([A-${lastLetter}])\\)\\s*(.+)$`, 'gm'))];
  const cMatch = rawQuestion.match(new RegExp(`CORRECT:\\s*([A-${lastLetter}])`));
  if (!qMatch || optMatches.length !== totalOptions || !cMatch) return null;

  const question = qMatch[1].trim();
  const parsedOptions = optMatches.map((m) => ({ letter: m[1], text: m[2].trim() }));
  const correctText = parsedOptions.find((o) => o.letter === cMatch[1])?.text;

  const shuffled = parsedOptions.map((o) => o.text);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const options = shuffled.map((text, i) => ({ letter: letters[i], text }));
  const correctAnswer = options.find((o) => o.text === correctText)?.letter || cMatch[1];

  return { question, options, correctAnswer };
}

// Levels 2, 4, 5: `correctMin`-`correctMax` correct options out of `totalOptions`,
// each option annotated with a CORRECT|INCORRECT explanation line. Option order is
// preserved (not shuffled) since correctness is derived per-letter from EXPLAIN_X.
function parseMultiSelect(rawQuestion, totalOptions, correctMin) {
  const letters = buildLetters(totalOptions);
  const lastLetter = letters[letters.length - 1];
  const qMatch = rawQuestion.match(new RegExp(`QUESTION:\\s*(.+?)(?=\\n[A-${lastLetter}]\\))`, 's'));
  const optMatches = [...rawQuestion.matchAll(new RegExp(`^([A-${lastLetter}])\\)\\s*(.+)$`, 'gm'))];

  const optionExplanations = {};
  const derivedCorrect = [];
  letters.forEach((l) => {
    const re = new RegExp('EXPLAIN_' + l + ':\\s*(CORRECT|INCORRECT)\\s*\\|\\s*(.+)');
    const m = rawQuestion.match(re);
    if (m) {
      optionExplanations[l] = m[2].trim();
      if (m[1].toUpperCase() === 'CORRECT') derivedCorrect.push(l);
    }
  });
  const cMatch = rawQuestion.match(new RegExp(`CORRECT:\\s*([A-${lastLetter}]+)`));
  if (!qMatch || optMatches.length < totalOptions || (derivedCorrect.length < correctMin && !cMatch)) return null;

  const question = qMatch[1].trim();
  const options = optMatches.map((m) => ({ letter: m[1], text: m[2].trim() }));
  const correctAnswers = derivedCorrect.length >= correctMin
    ? derivedCorrect
    : cMatch[1].toUpperCase().split('').filter((l) => letters.includes(l));

  return { question, options, correctAnswers, optionExplanations };
}

module.exports = { buildLetters, parseSingleChoice, parseMultiSelect };
