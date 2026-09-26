// BABOK RAG Chat & Training API Server
// Wraps the Pinecone + OpenAI query pipeline as an HTTP API with conversation history.
// Config, prompts, and business logic live under config/ and lib/ — see README.md.
//
// Setup:
//   1. npm install express
//   2. Add PINECONE_API_KEY and OPENAI_API_KEY to .env
//   3. Ensure vectors are uploaded (node trainer/pinecone-upload.js)
//
// Run:
//   node trainer/server.js
//
// Endpoints:
//   POST /api/chat            — send a message, get a RAG-powered answer
//   POST /api/train/question  — get a BABOK training question
//   POST /api/train/evaluate  — evaluate user's answer against BABOK
//   GET  /                    — serves the training UI
//   GET  /chat                — serves the chat UI

require('dotenv').config();
const express = require('express');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const config = require('./config');
const { CONFIG } = config;

if (!process.env.PINECONE_API_KEY || !process.env.OPENAI_API_KEY) {
  console.error('❌ Set PINECONE_API_KEY and OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI();
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(CONFIG.indexName);

const { chunkMap, trainableChunks } = require('./lib/chunkStore');
const accessors = require('./lib/chunkAccessors');
const { createChunkFormatting } = require('./lib/chunkFormatting');
const { createRagPipeline } = require('./lib/rag');
const { fillTemplate } = require('./lib/templates');
const aspectRotation = require('./lib/aspectRotation');
const topicPools = require('./lib/topicPools');

const chunkFormatting = createChunkFormatting({ chunkMap, categoryLabels: config.CHUNK_CATEGORY_LABELS });
const rag = createRagPipeline({
  openai,
  index,
  config: CONFIG,
  chunkMap,
  extractReferenceText: chunkFormatting.extractReferenceText,
  getMetaType: accessors.getMetaType,
  getMetaLabel: accessors.getMetaLabel,
});

const { createChatRouter } = require('./routes/chat');
const { createTrainRouter } = require('./routes/train');
const { createConfigRouter } = require('./routes/configRoutes');

const app = express();
app.use(express.json());

app.use(createChatRouter({ openai, config, retrieveContext: rag.retrieveContext, buildContextText: rag.buildContextText }));
app.use(createTrainRouter({ openai, config, trainableChunks, accessors, chunkFormatting, aspectRotation, topicPools, fillTemplate }));
app.use(createConfigRouter({ config }));

app.listen(CONFIG.port, () => {
  console.log(`\n🚀 BABOK Chat API running at http://localhost:${CONFIG.port}`);
  console.log(`   GET  /          — training mode UI`);
  console.log(`   GET  /chat      — chat UI`);
  console.log(`   POST /api/chat  — send { "message": "your question" }`);
  console.log(`   POST /api/train/question — get a training question`);
  console.log(`   POST /api/train/evaluate — evaluate your answer`);
  console.log(`   POST /api/reset — clear conversation { "sessionId": "..." }`);
  console.log(`   GET  /api/config  — read trainer config`);
  console.log(`   POST /api/config  — update trainer config`);
  console.log(`   GET  /api/prompts — read prompt templates`);
  console.log(`   POST /api/prompts — update prompt templates\n`);
});

