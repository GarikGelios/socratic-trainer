// Pure helpers for reading identifying/shaping fields off raw BABOK chunk objects.
// No I/O, no external state — safe to unit test directly with plain chunk fixtures.

function getChunkId(chunk) {
  return chunk?.id || chunk?.chunk_id || null;
}

function getChunkType(chunk) {
  return chunk?.doc_type || chunk?.chunk_type || 'unknown';
}

function getMetaType(meta, chunk) {
  return meta?.doc_type || meta?.chunk_type || getChunkType(chunk);
}

function getMetaLabel(meta, chunk) {
  return (
    meta?.title ||
    meta?.task_name ||
    meta?.technique_name ||
    meta?.task_title ||
    meta?.technique_title ||
    meta?.term ||
    meta?.role_name ||
    meta?.perspective_name ||
    meta?.perspective ||
    chunk?.title ||
    chunk?.task_name ||
    chunk?.technique_name ||
    chunk?.term ||
    chunk?.role_name ||
    getChunkId(chunk) ||
    'Unknown'
  );
}

function getChunkChapterNum(chunk) {
  if (Number.isInteger(chunk?.identification?.chapter_num)) return chunk.identification.chapter_num;
  if (typeof chunk?.chapter === 'string') {
    const match = chunk.chapter.match(/^(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function getChunkTaskSelectorId(chunk) {
  return chunk?.identification?.task_id || chunk?.section_id || null;
}

function slugifyTaskLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getCanonicalTaskId(chunk) {
  if (chunk?.section_id) return String(chunk.section_id);
  if (chunk?.identification?.task_id) return String(chunk.identification.task_id);
  if (chunk?.task_id) return String(chunk.task_id);
  const id = String(getChunkId(chunk) || '');
  let match = id.match(/^task-(\d+\.\d+)-/);
  if (match) return match[1];
  match = id.match(/^mapping-task-(\d+\.\d+)-/);
  if (match) return match[1];
  return null;
}

function getChunkTaskSelectorKeys(chunk) {
  const keys = new Set();
  const canonicalId = getCanonicalTaskId(chunk);
  if (canonicalId) keys.add(canonicalId.toLowerCase());

  const titleSlug = slugifyTaskLabel(chunk?.identification?.task_title || chunk?.title || chunk?.task_name);
  if (titleSlug) keys.add(titleSlug);

  const id = String(getChunkId(chunk) || '').toLowerCase();
  let match = id.match(/^task-\d+\.\d+-([a-z0-9-]+)-/);
  if (match && match[1]) keys.add(match[1]);
  match = id.match(/^mapping-task-\d+\.\d+-([a-z0-9-]+)(?:-|$)/);
  if (match && match[1]) keys.add(match[1]);

  return keys;
}

function extractTaskIdsFromTextList(values) {
  const ids = new Set();
  if (!Array.isArray(values)) return ids;
  values.forEach((value) => {
    const matches = String(value || '').match(/\b\d+\.\d+\b/g) || [];
    matches.forEach((id) => ids.add(id));
  });
  return ids;
}

module.exports = {
  getChunkId,
  getChunkType,
  getMetaType,
  getMetaLabel,
  getChunkChapterNum,
  getChunkTaskSelectorId,
  slugifyTaskLabel,
  getCanonicalTaskId,
  getChunkTaskSelectorKeys,
  extractTaskIdsFromTextList,
};
