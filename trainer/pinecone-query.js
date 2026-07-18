// BABOK RAG Query Script
// Embeds a question, queries Pinecone for relevant chunks, and generates an answer
//
// Setup:
//   1. Add PINECONE_API_KEY and OPENAI_API_KEY to .env file
//   2. Ensure vectors are uploaded (node chunker/pinecone-upload.js)
//
// Usage:
//   node chunker/pinecone-query.js "What is stakeholder engagement?"
//   node chunker/pinecone-query.js "What techniques help with elicitation?" --chunks-only
//   node chunker/pinecone-query.js "Explain the BACCM model" --top 10

require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
//  indexName: 'ba-training',
  indexName: 'ba-training-large',
  //embeddingModel: 'text-embedding-3-small',
  embeddingModel: 'text-embedding-3-large',
  chatModel: 'gpt-4o-mini',
  topK: 5,               // number of chunks to retrieve
  scoreThreshold: 0.3,    // minimum similarity score to include
};

// ============================================================================
// PARSE CLI ARGUMENTS
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { question: '', chunksOnly: false, topK: CONFIG.topK };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chunks-only') {
      options.chunksOnly = true;
    } else if (args[i] === '--top' && args[i + 1]) {
      options.topK = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith('--')) {
      options.question = args[i];
    }
  }

  if (!options.question) {
    console.error('Usage: node trainer/pinecone-query.js "Your question here" [--chunks-only] [--top N]');
    console.error('\nExamples:');
    console.error('  node trainer/pinecone-query.js "What is stakeholder engagement?"');
    console.error('  node trainer/pinecone-query.js "List elicitation techniques" --chunks-only');
    console.error('  node trainer/pinecone-query.js "Explain BACCM" --top 10');
    process.exit(1);
  }

  return options;
}

// ============================================================================
// QUERY PIPELINE
// ============================================================================

async function main() {
  const { question, chunksOnly, topK } = parseArgs();

  if (!process.env.PINECONE_API_KEY) {
    console.error('вќЊ PINECONE_API_KEY not set in .env');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('вќЊ OPENAI_API_KEY not set in .env');
    process.exit(1);
  }

  const openai = new OpenAI();
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.index(CONFIG.indexName);

  // Step 1: Embed the question
  console.log(`\nвќ“ Question: "${question}"\n`);
  console.log('рџ”Ќ Embedding question...');

  const embeddingResponse = await openai.embeddings.create({
    model: CONFIG.embeddingModel,
    input: question,
  });
  const queryVector = embeddingResponse.data[0].embedding;

  // Step 2: Query Pinecone
  console.log(`рџ“Ў Querying Pinecone (top ${topK})...\n`);

  const results = await index.query({
    vector: queryVector,
    topK: topK,
    includeMetadata: true,
  });

  const matches = (results.matches || []).filter(m => m.score >= CONFIG.scoreThreshold);

  if (matches.length === 0) {
    console.log('вљ пёЏ  No relevant chunks found above score threshold.');
    process.exit(0);
  }

  // Step 3: Display retrieved chunks
  console.log(`рџ“љ Retrieved ${matches.length} chunks:\n`);
  console.log('в”Ђ'.repeat(70));

  matches.forEach((match, i) => {
    const meta = match.metadata || {};
    const label = meta.task_title || meta.technique_title || meta.term || meta.role_name || meta.perspective || meta.chunk_type || match.id;
    console.log(`  ${i + 1}. [${match.score.toFixed(3)}] ${label}`);
    console.log(`     ID: ${match.id}`);
    console.log(`     Type: ${meta.chunk_type || 'unknown'} | Source: ${meta.source_file || 'N/A'}`);

    // Show extra metadata based on chunk type
    if (meta.chapter_title) console.log(`     Chapter: ${meta.chapter_title}`);
    if (meta.perspective) console.log(`     Perspective: ${meta.perspective}`);
    console.log('');
  });
  console.log('в”Ђ'.repeat(70));

  if (chunksOnly) {
    console.log('\nвњ… Chunks-only mode вЂ” skipping LLM answer generation.');
    process.exit(0);
  }

  // Step 4: Build context from chunk JSONL data (richer than metadata alone)
  console.log('\nрџ¤– Generating answer...\n');

  // Load full chunk data for retrieved IDs
  const fs = require('fs');
  // Chunks produced by the chunker module — resolve path relative to this file
  const chunksFile = require('path').join(__dirname, '../chunker/embeddings-chunks.jsonl');
  const chunkLines = fs.readFileSync(chunksFile, 'utf8').split('\n').filter(Boolean);
  const chunkMap = new Map();
  chunkLines.forEach(line => {
    const chunk = JSON.parse(line);
    chunkMap.set(chunk.chunk_id, chunk);
  });

  const contextParts = matches.map((match, i) => {
    const fullChunk = chunkMap.get(match.id);
    if (!fullChunk) return `[${i + 1}] (chunk data not found for ${match.id})`;

    // Build readable context based on chunk type
    const parts = [`[${i + 1}] ${fullChunk.chunk_id} (score: ${match.score.toFixed(3)})`];

    if (fullChunk.purpose) parts.push(`Purpose: ${fullChunk.purpose}`);
    if (fullChunk.description) parts.push(`Description: ${fullChunk.description}`);
    if (fullChunk.definition) parts.push(`${fullChunk.term}: ${fullChunk.definition}`);
    if (fullChunk.explanation) parts.push(`Explanation: ${fullChunk.explanation}`);
    if (fullChunk.content?.overview) parts.push(`Overview: ${fullChunk.content.overview}`);

    if (fullChunk.elements?.length) {
      parts.push('Elements:');
      fullChunk.elements.forEach(e => parts.push(`  - ${e.title}: ${e.description?.substring(0, 200) || ''}`));
    }

    if (fullChunk.techniques?.length) {
      parts.push('Techniques: ' + fullChunk.techniques.map(t => t.title || t.name).join(', '));
    }

    return parts.join('\n');
  });

  const context = contextParts.join('\n\n---\n\n');

  // Step 5: Generate answer with GPT
  const systemPrompt = `You are a Business Analysis expert trained on the BABOKВ® Guide (Business Analysis Body of Knowledge).
Answer questions using ONLY the provided context from the BABOK guide. Be specific and reference BABOK concepts, tasks, and techniques.
If the context doesn't contain enough information to fully answer, say so.
Format your answer with clear structure using headers, bullet points, and bold for key terms.`;

  const completion = await openai.chat.completions.create({
    model: CONFIG.chatModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Context from BABOK Guide:\n\n${context}\n\n---\n\nQuestion: ${question}` },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  const answer = completion.choices[0].message.content;

  console.log('в•ђ'.repeat(70));
  console.log('ANSWER');
  console.log('в•ђ'.repeat(70));
  console.log(answer);
  console.log('в•ђ'.repeat(70));
  console.log(`\nTokens used: ${completion.usage.prompt_tokens} prompt + ${completion.usage.completion_tokens} completion = ${completion.usage.total_tokens} total`);
  console.log(`Model: ${CONFIG.chatModel}`);
  console.log(`Chunks used: ${matches.length}`);
}

main().catch(err => {
  console.error('\nвќЊ Error:', err.message);
  process.exit(1);
});
