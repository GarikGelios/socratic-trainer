// Loads BABOK chunk data (produced by chunker/chunker.js) once at startup.
const fs = require('fs');
const path = require('path');
const { getChunkId, getChunkType } = require('./chunkAccessors');

const chunksPath = path.join(__dirname, '../../chunker/embeddings-chunks.jsonl');
const chunkMap = new Map();

if (fs.existsSync(chunksPath)) {
  const lines = fs.readFileSync(chunksPath, 'utf8').split('\n').filter(Boolean);
  lines.forEach((line) => {
    const chunk = JSON.parse(line);
    const id = getChunkId(chunk);
    if (id) chunkMap.set(id, chunk);
  });
  console.log(`📚 Loaded ${chunkMap.size} chunks`);
} else {
  console.error(`❌ Chunks file not found: ${chunksPath}`);
  console.error('   Run: node chunker/chunker.js  (chunker module)');
  process.exit(1);
}

// Chunks suitable for training questions (skips redirect stubs and tiny glossary entries)
const trainableChunks = [];
for (const [, chunk] of chunkMap) {
  const type = getChunkType(chunk);
  if (chunk.cross_reference?.type === 'redirect') continue;
  if ((type === 'glossary_term' || type === 'glossary') && (!chunk.definition || chunk.definition.length < 40)) continue;
  trainableChunks.push(chunk);
}
console.log(`🎓 ${trainableChunks.length} chunks available for training`);

module.exports = { chunkMap, trainableChunks };
