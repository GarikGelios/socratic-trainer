// Best-effort safety net against "cognate leakage" — where the question stem repeats a
// distinctive word/word-root from the correct option's own text (e.g. stem says
// "enterprise limitations" and the correct option is "Assess Enterprise Limitations"),
// letting the student pattern-match instead of applying BABOK knowledge. This is a backstop
// on top of the anti-leakage instructions in trainer-prompts.json, not a replacement for them.

// Generic domain/connective words that legitimately repeat between a BABOK stem and its
// correct option without constituting a giveaway — excluded so the check only flags
// distinctive nouns/terms (like "limitations", "governance", "traceability").
const STOPWORDS = new Set([
  'business', 'analysis', 'analyst', 'requirement', 'requirements', 'stakeholder', 'stakeholders',
  'technique', 'techniques', 'process', 'processes', 'information', 'management', 'manage',
  'solution', 'solutions', 'following', 'question', 'option', 'options', 'correct', 'should',
  'which', 'their', 'there', 'about', 'within', 'across', 'during', 'before', 'after', 'without',
  'because', 'however', 'therefore', 'provide', 'provides', 'primarily', 'directly', 'specifically',
  'generally', 'typically', 'several', 'various', 'different', 'similar', 'related', 'relevant',
  'important', 'necessary', 'appropriate', 'applicable', 'babok', 'guide', 'knowledge', 'area',
  'areas', 'task', 'tasks', 'element', 'elements', 'activity', 'activities', 'perspective', 'perspectives',
]);

// Naive suffix-stripping so "limitations"/"limitation"/"limiting" collapse to the same root.
function stripSuffix(word) {
  return word
    .replace(/ies$/, 'y')
    .replace(/(tions|sions)$/, 't')
    .replace(/(ing|ions|tion|ives|ance|ence|ties)$/, '')
    .replace(/(ed|es|ive|al|ity)$/, '')
    .replace(/s$/, '');
}

// Only distinctive content words (length >= 7, not a stopword) are considered leak-worthy.
function contentWords(text) {
  return (text.match(/[A-Za-z]+/g) || [])
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 7 && !STOPWORDS.has(w));
}

// Returns the leaked word(s) as they appear in the correct option text, or [] if none found.
function detectLeakedWords(stemText, correctOptionTexts) {
  const stemRoots = new Set(contentWords(stemText).map(stripSuffix));
  const leaked = [];
  const seenRoots = new Set();
  (correctOptionTexts || []).forEach((optText) => {
    contentWords(optText || '').forEach((word) => {
      const root = stripSuffix(word);
      if (stemRoots.has(root) && !seenRoots.has(root)) {
        seenRoots.add(root);
        leaked.push(word);
      }
    });
  });
  return leaked;
}

module.exports = { detectLeakedWords };
