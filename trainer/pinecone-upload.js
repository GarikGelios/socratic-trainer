// BABOK Pinecone Upload Script
// Reads JSONL chunks, generates OpenAI embeddings, and upserts to Pinecone
//
// Setup:
//   1. Add PINECONE_API_KEY and OPENAI_API_KEY to .env file
//   2. Ensure "ba-training" index exists (dimension=1536, metric=cosine)
//
// Run:
//   node trainer/pinecone-upload.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
//  indexName: 'ba-training',
  indexName: 'ba-training-large',
  // Chunks file produced by the chunker module — resolved relative to this file
  chunksFile: path.join(__dirname, '../chunker/embeddings-chunks.jsonl'),
 // embeddingModel: 'text-embedding-3-small', // 1536 dimensions
  embeddingModel: 'text-embedding-3-large', // 3072 dimensions
  batchSize: 50, // vectors per Pinecone upsert batch
  embeddingBatchSize: 10, // texts per OpenAI embedding call (kept small for free-tier TPM limits)
  embeddingDelayMs: 61000, // delay between embedding batches (60s+ to reset TPM window)
};

// ============================================================================
// TEXT EXTRACTION — Build embedding text from each chunk type
// ============================================================================

/**
 * New chunk schema stores the embedding text directly in chunk.text (spec §6).
 * Truncate to OpenAI's ~8191-token limit.
 */
function extractTextForEmbedding(chunk) {
  const text = chunk.text || JSON.stringify(chunk);
  const maxChars = 8191 * 4;
  return text.length > maxChars ? text.substring(0, maxChars) : text;
}

// ============================================================================
// METADATA — Build Pinecone metadata from chunk (must be flat key-value)
// ============================================================================

/** Build flat Pinecone metadata from the new doc_type-based chunk schema */
function buildMetadata(chunk) {
  const meta = {
    doc_type: chunk.doc_type || '',
    source_file: chunk.source_file || '',
    sub_section: chunk.sub_section || '',
  };

  switch (chunk.doc_type) {
    case 'task':
      meta.chapter = chunk.chapter || '';
      meta.section_id = chunk.section_id || '';
      meta.title = chunk.title || '';
      break;
    case 'technique':
      meta.technique_id = chunk.technique_id || '';
      meta.technique_name = chunk.technique_name || '';
      break;
    case 'technique_task_mapping':
      meta.technique_id = chunk.technique_id || '';
      meta.technique_name = chunk.technique_name || '';
      meta.mapped_task_ids = (chunk.mapped_task_ids || []).join(', ');
      break;
    case 'task_task_mapping':
      meta.task_id = chunk.task_id || '';
      meta.task_name = chunk.task_name || '';
      meta.chapter = chunk.chapter || '';
      if (chunk.mapping_entity) meta.mapping_entity = chunk.mapping_entity;
      break;
    case 'competency':
      meta.competency_category = chunk.competency_category || '';
      meta.competency_name = chunk.competency_name || '';
      break;
    case 'perspective':
      meta.perspective_name = chunk.perspective_name || '';
      break;
    case 'glossary':
      meta.term = chunk.term || '';
      break;
  }

  return meta;
}

// ============================================================================
// MAIN UPLOAD LOGIC
// ============================================================================

async function main() {
  // Validate environment
  if (!process.env.PINECONE_API_KEY) {
    console.error('❌ PINECONE_API_KEY not set in .env');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set in .env');
    process.exit(1);
  }

  // Load chunks
  console.log('📂 Loading chunks...');
  const lines = fs.readFileSync(CONFIG.chunksFile, 'utf8').split('\n').filter(Boolean);
  const chunks = lines.map(line => JSON.parse(line));
  console.log(`   Loaded ${chunks.length} chunks`);

  // Extract text for each chunk (truncation to 8191-token limit handled inside)
  console.log('\n📝 Extracting text for embedding...');
  const texts = chunks.map(extractTextForEmbedding);

  // Generate embeddings (or load cached)
  // Cache lives inside the trainer module folder
  const cacheFile = path.join(__dirname, 'embeddings-cache.json');
  let allEmbeddings;

  if (fs.existsSync(cacheFile)) {
    console.log(`\n💾 Loading cached embeddings from ${cacheFile}...`);
    allEmbeddings = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`   Loaded ${allEmbeddings.length} cached embeddings`);
  } else {
    console.log(`\n🧠 Generating embeddings with ${CONFIG.embeddingModel}...`);
    const openai = new OpenAI();
    allEmbeddings = [];

  for (let i = 0; i < texts.length; i += CONFIG.embeddingBatchSize) {
    const batch = texts.slice(i, i + CONFIG.embeddingBatchSize);
    const batchNum = Math.floor(i / CONFIG.embeddingBatchSize) + 1;
    const totalBatches = Math.ceil(texts.length / CONFIG.embeddingBatchSize);

    process.stdout.write(`   Batch ${batchNum}/${totalBatches} (${batch.length} texts)...`);

    const response = await openai.embeddings.create({
      model: CONFIG.embeddingModel,
      input: batch,
    });

    response.data.forEach(item => {
      allEmbeddings.push(item.embedding);
    });

    console.log(' ✅');

    // Rate limit delay (skip after last batch)
    if (i + CONFIG.embeddingBatchSize < texts.length && CONFIG.embeddingDelayMs > 0) {
      const waitSec = Math.ceil(CONFIG.embeddingDelayMs / 1000);
      process.stdout.write(`   ⏳ Waiting ${waitSec}s for rate limit...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.embeddingDelayMs));
      console.log(' ready');
    }
  }

    console.log(`   Generated ${allEmbeddings.length} embeddings`);

    // Cache embeddings to avoid re-generating
    fs.writeFileSync(cacheFile, JSON.stringify(allEmbeddings));
    console.log(`   💾 Saved embeddings cache to ${cacheFile}`);
  }

  // Upsert to Pinecone in batches
  console.log(`\n📤 Uploading to Pinecone index "${CONFIG.indexName}"...`);
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(CONFIG.indexName);
  const ns = index.namespace(''); // default namespace

  let uploaded = 0;
  for (let i = 0; i < chunks.length; i += CONFIG.batchSize) {
    const batchChunks = chunks.slice(i, i + CONFIG.batchSize);
    const batchEmbeddings = allEmbeddings.slice(i, i + CONFIG.batchSize);

    const vectors = batchChunks.map((chunk, j) => ({
      id: chunk.id,
      values: batchEmbeddings[j],
      metadata: buildMetadata(chunk),
    })).filter(v => v.id && v.values);

    if (vectors.length === 0) continue;

    await ns.upsert({ records: vectors });
    uploaded += vectors.length;

    const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / CONFIG.batchSize);
    console.log(`   Batch ${batchNum}/${totalBatches}: upserted ${vectors.length} vectors (${uploaded}/${chunks.length} total)`);
  }

  // Verify
  console.log('\n📊 Verifying upload...');
  // Small delay to allow Pinecone to index
  await new Promise(resolve => setTimeout(resolve, 2000));
  const stats = await ns.describeIndexStats();
  console.log(`   Total vectors in index: ${stats.totalRecordCount}`);

  console.log('\n✅ Upload complete!');
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
