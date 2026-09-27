// Best-effort safety net against "inverted / self-contradicting" multi-select options — where
// the model marks two mutually-exclusive statements (e.g. "A produces B" and "B produces A")
// both CORRECT just to satisfy the required correct-option count, or writes an explanation that
// asserts the opposite of its own option's text. This is a backstop on top of the explicit
// anti-inversion / explanation-consistency rules in trainer-prompts.json, not a replacement.

const PRODUCE_VERBS = /^(produces?|creates?|generates?|outputs?|produced|created|generated|output)$/i;
const USE_VERBS = /^(uses?|consumes?|relies\s+on|requires?|depends\s+on|used|consumed|required)$/i;
const ENTITY = '(Task\\s+[\\d]+(?:\\.[\\d]+)?|[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,4})';
const ACTIVE_RE = new RegExp(ENTITY + '\\s+(produces?|creates?|generates?|outputs?|uses?|consumes?|relies\\s+on|requires?|depends\\s+on)\\b', 'gi');
const PASSIVE_RE = new RegExp('\\b(?:is\\s+|are\\s+)?(produced|created|generated|output|used|consumed|required)\\s+by\\s+' + ENTITY, 'gi');

// Finds "<Entity> <directional verb>" (active) and "<verb> by <Entity>" (passive) clauses
// (e.g. "Task 8.1 produces it" or "produced by Task 8.1") and returns a signature of
// { entity, role } tuples, where role is 'PRODUCE' or 'USE'.
function extractRoleSignature(text) {
  if (!text) return [];
  const signature = [];
  let m;
  ACTIVE_RE.lastIndex = 0;
  while ((m = ACTIVE_RE.exec(text)) !== null) {
    const entity = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const role = PRODUCE_VERBS.test(m[2]) ? 'PRODUCE' : USE_VERBS.test(m[2]) ? 'USE' : null;
    if (role) signature.push({ entity, role });
  }
  PASSIVE_RE.lastIndex = 0;
  while ((m = PASSIVE_RE.exec(text)) !== null) {
    const entity = m[2].trim().toLowerCase().replace(/\s+/g, ' ');
    const role = PRODUCE_VERBS.test(m[1]) ? 'PRODUCE' : USE_VERBS.test(m[1]) ? 'USE' : null;
    if (role) signature.push({ entity, role });
  }
  return signature;
}

// options: array of { letter, text } already restricted to those marked CORRECT.
// Returns conflicts where two different correct options assign opposite roles to the same entity.
function detectInvertedOptionPairs(options) {
  const signed = options.map((o) => ({ ...o, sig: extractRoleSignature(o.text) }));
  const conflicts = [];
  for (let i = 0; i < signed.length; i++) {
    for (let j = i + 1; j < signed.length; j++) {
      const entities = new Set();
      signed[i].sig.forEach((sa) => {
        signed[j].sig.forEach((sb) => {
          if (sa.entity === sb.entity && sa.role !== sb.role) entities.add(sa.entity);
        });
      });
      if (entities.size > 0) {
        conflicts.push({ entities: [...entities], textA: signed[i].text, textB: signed[j].text });
      }
    }
  }
  return conflicts;
}

// options: array of { letter, text, explanation }. Flags an option whose own explanation
// asserts the opposite role for an entity from what the option's own text asserts.
function detectSelfContradictingExplanations(options) {
  const problems = [];
  (options || []).forEach((o) => {
    if (!o.explanation) return;
    const textSig = extractRoleSignature(o.text);
    const explSig = extractRoleSignature(o.explanation);
    const entities = new Set();
    textSig.forEach((ts) => {
      explSig.forEach((es) => {
        if (ts.entity === es.entity && ts.role !== es.role) entities.add(ts.entity);
      });
    });
    if (entities.size > 0) {
      problems.push({ entities: [...entities], text: o.text, explanation: o.explanation });
    }
  });
  return problems;
}

module.exports = { detectInvertedOptionPairs, detectSelfContradictingExplanations };
