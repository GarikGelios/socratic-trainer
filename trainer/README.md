# Trainer Module

The trainer module uploads generated chunks to Pinecone and runs the local chat and training API. Start it from the repository root with `npm start` or run `node trainer/server.js` directly.

For first-time installation and API keys, see the [root README](../README.md). For the HTML-to-chunk rules and embedding text, see the [chunker guide](../chunker/README.md) and its [parser specification](../chunker/PARSER_SPEC.md).

## How The App Runs

```text
trainer/server.js
  -> loads settings and prompts from JSON
  -> creates OpenAI and Pinecone clients
  -> loads chunker/embeddings-chunks.jsonl
  -> wires logic modules into Express routers
   -> serves train.html at / and chat.html at /chat
```

The chat and training pages call the API endpoints. Route handlers validate requests, call application logic, and return JSON responses. Business rules and chunk operations are separated into `lib/` modules so they can be inspected and tested independently of Express.

## Where Things Live

| Path | Responsibility |
|------|----------------|
| `server.js` | Application entry point: loads environment variables, initializes API clients, connects modules, and starts Express. |
| `config/index.js` | Reads the two JSON settings files and exposes shared in-memory settings; persists updates from the Settings API. |
| `trainer-config.json` | Server settings, training thresholds, level names/token limits, aspect rotation entries, and chunk display labels. |
| `trainer-prompts.json` | Chat and feedback templates plus level question/evaluation instructions. |
| `routes/chat.js` | Chat page at `/chat` and chat/reset API routes. |
| `routes/train.js` | Trainer page at `/` and question/evaluation/reset API routes. `/train` redirects to `/`. |
| `routes/configRoutes.js` | Settings API used by the training page's Settings panel. |
| `lib/chunkStore.js` | Loads JSONL chunks and filters out chunks unsuitable for training. |
| `lib/chunkAccessors.js` | Reads common identity and classification fields from chunk objects. |
| `lib/chunkFormatting.js` | Formats chunk references and labels; builds complete task context and canonical-value guardrails. |
| `lib/topicPools.js` | Selects chunks for chapter, task, concept, competency, perspective, and drill topics. |
| `lib/aspectRotation.js` | Chooses varied question angles by chunk type. |
| `lib/rag.js` | Embeds chat questions, queries Pinecone, and formats retrieved context. |
| `lib/sessionStore.js` | Holds temporary in-memory chat and training sessions. Sessions are lost when the server stops. |
| `lib/templates.js` | Replaces placeholders such as `{topic}` in prompt templates. |
| `pinecone-upload.js` | Embeds chunk text and upserts vectors plus metadata to Pinecone. |
| `pinecone-query.js`, `pinecone-test.js` | Developer tools for querying and checking the Pinecone index. |
| `chat.html`, `train.html` | Browser interfaces for chat and training. |
| `embeddings-cache.json` | Local cache of generated embeddings used by the uploader. |

## Settings And Prompts

The checked-in JSON files are the application source of truth; the server code does not provide a second set of defaults. Keep both files present and valid JSON. The loader currently produces empty/missing values when a file or field is absent, so do not remove required entries.

- Edit training thresholds, level labels and token limits, question aspects, and display labels in [`trainer-config.json`](trainer-config.json).
- Edit chat instructions, feedback templates, level question instructions, and evaluation instructions in [`trainer-prompts.json`](trainer-prompts.json).
- Level settings are intentionally split between the files: `trainer-config.json` has the level name/description/token limits; `trainer-prompts.json` has the level prompt/evaluation text. The loader combines these into the level objects used at runtime.
- The training page's Settings panel uses `GET/POST /api/config` and `GET/POST /api/prompts` to read and save its supported settings. Edits through these endpoints are persisted to the same JSON files and take effect in memory immediately.
- Model, embedding, index, and port values are not editable in the Settings panel. Edit `trainer-config.json`; restart the server for changes to the Pinecone index, since the client is created during startup. Restart after other direct file edits for predictable behavior.
- API keys belong in the project-root `.env` file, not in either JSON file.

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Serve trainer UI. |
| `GET` | `/chat` | Serve chat UI. |
| `POST` | `/api/chat` | Retrieve BABOK context and generate a chat answer. |
| `POST` | `/api/reset` | Clear chat session history. |
| `GET` | `/train` | Redirect to the trainer UI at `/` (legacy route). |
| `POST` | `/api/train/question` | Choose a chunk and generate a question for the requested level/topic. |
| `POST` | `/api/train/evaluate` | Score the pending answer and update session statistics. |
| `POST` | `/api/train/reset` | Clear training session state. |
| `GET`, `POST` | `/api/config` | Read or update supported app/training settings. |
| `GET`, `POST` | `/api/prompts` | Read or update prompt templates and level instructions. |

The request fields and topic values are implemented in `routes/train.js` and selected by `lib/topicPools.js`; consult those files when changing the API behavior.

## Pinecone And Embeddings

Both upload and server retrieval must use the same Pinecone index and embedding model. The uploader currently defines these in `pinecone-upload.js`; the server reads the index and model from `trainer-config.json`. The embedding dimension must match the Pinecone index dimension.

The uploader embeds each chunk's prebuilt `text` field (see [how chunk text is created](../chunker/PARSER_SPEC.md#6-chunk-text-quality-rules-for-embeddings)) and writes vectors in batches. Keep `trainer/embeddings-cache.json` to reuse cached embeddings when possible.

## Refreshing The Index

After changing source HTML or chunk-generation behavior:

1. Follow the parser spec and regenerate the JSONL:

   ```bash
   npm run chunk
   ```

2. Remove the embedding cache so changed text is re-embedded:

   ```powershell
   Remove-Item trainer/embeddings-cache.json -ErrorAction SilentlyContinue
   ```

3. Upload the updated chunks and verify the index:

   ```bash
   npm run upload
   node trainer/pinecone-test.js
   ```

For a new Pinecone index or a full rebuild, review the upload/index handling in `pinecone-upload.js` before running it. Upserting an existing chunk ID replaces that vector; new IDs add vectors. The [root guide](../README.md) covers the basic end-to-end setup.
