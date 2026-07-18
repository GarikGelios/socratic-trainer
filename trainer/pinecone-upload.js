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
 * Extract the most meaningful text from a chunk for embedding.
 * Different chunk types have different field structures.
 */
function extractTextForEmbedding(chunk) {
  switch (chunk.chunk_type) {
    case 'task':
      return buildTaskText(chunk);
    case 'technique':
      return buildTechniqueText(chunk);
    case 'glossary_term':
    case 'key_term':
      return `${chunk.term}: ${chunk.definition}`;
    case 'stakeholder_role':
      return `${chunk.role_name}: ${chunk.definition}`;
    case 'conceptual_framework':
      return buildConceptualFrameworkText(chunk);
    case 'classification_schema':
      return buildClassificationText(chunk);
    case 'conceptual_explanation':
      return `${chunk.title}. ${chunk.explanation || ''} ${chunk.key_principle || ''}`.trim();
    case 'perspective_section':
      return `${chunk.perspective} Perspective - ${chunk.section}: ${chunk.content}`;
    case 'perspective_impact':
      return buildPerspectiveImpactText(chunk);
    case 'perspective_table':
      return buildPerspectiveTableText(chunk);
    default:
      return JSON.stringify(chunk);
  }
}

function buildTaskText(chunk) {
  const id = chunk.identification || {};
  const parts = [
    `${id.task_title || ''} (${id.chapter_title || ''})`,
    chunk.purpose || '',
    chunk.description || '',
  ];

  if (Array.isArray(chunk.elements)) {
    chunk.elements.forEach(e => {
      parts.push(`${e.title}: ${e.description}`);
    });
  }

  if (Array.isArray(chunk.techniques)) {
    parts.push('Techniques: ' + chunk.techniques.map(t => `${t.title} - ${t.description}`).join('; '));
  }

  return parts.filter(Boolean).join('\n');
}

function buildTechniqueText(chunk) {
  const id = chunk.identification || {};
  const parts = [
    id.technique_title || '',
    chunk.purpose || '',
    chunk.description || '',
  ];

  if (Array.isArray(chunk.elements)) {
    chunk.elements.forEach(e => {
      parts.push(`${e.title}: ${e.description}`);
    });
  }

  if (chunk.usage_considerations) {
    if (chunk.usage_considerations.strengths?.length) {
      parts.push('Strengths: ' + chunk.usage_considerations.strengths.join('; '));
    }
    if (chunk.usage_considerations.limitations?.length) {
      parts.push('Limitations: ' + chunk.usage_considerations.limitations.join('; '));
    }
  }

  return parts.filter(Boolean).join('\n');
}

function buildConceptualFrameworkText(chunk) {
  const parts = [chunk.title || '', chunk.description || ''];

  if (Array.isArray(chunk.core_concepts)) {
    chunk.core_concepts.forEach(c => {
      parts.push(`${c.concept}: ${c.definition}`);
    });
  }

  return parts.filter(Boolean).join('\n');
}

function buildClassificationText(chunk) {
  const parts = [chunk.title || '', chunk.description || ''];

  if (Array.isArray(chunk.requirement_types)) {
    chunk.requirement_types.forEach(t => {
      parts.push(`${t.type}: ${t.definition}`);
    });
  }

  return parts.filter(Boolean).join('\n');
}

function buildPerspectiveImpactText(chunk) {
  const parts = [
    `${chunk.perspective} Perspective - Impact on ${chunk.knowledge_area}`,
    chunk.context || '',
    chunk.description || '',
  ];

  if (Array.isArray(chunk.techniques)) {
    parts.push('Techniques: ' + chunk.techniques.map(t => `${t.name}: ${t.description}`).join('; '));
  }

  return parts.filter(Boolean).join('\n');
}

function buildPerspectiveTableText(chunk) {
  const parts = [chunk.table_title || ''];
  const items = chunk.approaches || chunk.techniques || [];
  items.forEach(item => {
    parts.push(`${item.name}: ${item.description}`);
  });
  return parts.filter(Boolean).join('\n');
}

// ============================================================================
// METADATA — Build Pinecone metadata from chunk (must be flat key-value)
// ============================================================================

function buildMetadata(chunk) {
  const meta = {
    chunk_type: chunk.chunk_type,
    source_file: chunk.metadata?.source_file || '',
  };

  switch (chunk.chunk_type) {
    case 'task': {
      const id = chunk.identification || {};
      meta.chapter_num = id.chapter_num || 0;
      meta.chapter_title = id.chapter_title || '';
      meta.task_id = id.task_id || '';
      meta.task_title = id.task_title || '';
      break;
    }
    case 'technique': {
      const id = chunk.identification || {};
      meta.technique_num = id.technique_num || '';
      meta.technique_title = id.technique_title || '';
      break;
    }
    case 'glossary_term':
    case 'key_term':
      meta.term = chunk.term || '';
      break;
    case 'stakeholder_role':
      meta.role_name = chunk.role_name || '';
      break;
    case 'perspective_section':
    case 'perspective_impact':
    case 'perspective_table':
      meta.perspective = chunk.perspective || '';
      meta.perspective_num = chunk.perspective_num || '';
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

  // Extract text for each chunk
  console.log('\n📝 Extracting text for embedding...');
  const texts = chunks.map(extractTextForEmbedding);

  // Truncate very long texts (OpenAI has 8191 token limit per text)
  const maxChars = 8000 * 4; // rough estimate: 4 chars per token
  texts.forEach((t, i) => {
    if (t.length > maxChars) {
      texts[i] = t.substring(0, maxChars);
    }
  });

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
      id: chunk.chunk_id,
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
