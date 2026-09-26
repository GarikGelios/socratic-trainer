# Socratic AI Trainer

A local study app with two ways to work with BABOK content: ask questions in a RAG chat, or practice with generated training questions. The app retrieves passages from a Pinecone index and uses OpenAI models to answer, generate, and evaluate.

This repository contains the application and HTML-to-chunk tooling. The BABOK source HTML is supplied separately; configure its folder with `BOOK_PATH` before generating chunks.

## Get Started

Requirements: Node.js, OpenAI and Pinecone API keys, and access to a Pinecone index configured for the selected embedding model.

1. Install dependencies for the two modules:

   ```bash
   npm install --prefix chunker
   npm install --prefix trainer
   ```

2. Create a `.env` file in the project root. Set `BOOK_PATH` to the book folder that contains `chapters/`. Relative paths are resolved from the project root; `../html-book` is an example, not a required location.

   ```env
   OPENAI_API_KEY=your-openai-key
   PINECONE_API_KEY=your-pinecone-key
   BOOK_PATH=../html-book
   ```

   The expected layout is `<BOOK_PATH>/chapters/...`, including the chapter files listed in the [parser specification](chunker/PARSER_SPEC.md#1-source-file-inventory-and-schema-classification). The chunker checks that the folder exists and reports the resolved path if it does not.

3. Generate chunks, upload them, and start the app:

   ```bash
   npm run chunk
   npm run upload
   npm start
   ```

4. Open `http://localhost:3000` for the trainer or `http://localhost:3000/chat` for chat.

Uploading may take a while because embeddings are generated in batches. The uploader caches generated embeddings in `trainer/embeddings-cache.json` to avoid repeating that work.

## Project Map

```text
chunker/   Converts BABOK HTML into JSONL chunks for embedding
trainer/   Uploads chunks, runs the API, and serves the chat/training pages
```

Start with the guide matching the work you want to do:

- [Trainer guide](trainer/README.md): server architecture, settings and prompt editing, routes, upload/retrieval flow.
- [Chunker guide](chunker/README.md): generating chunks and where the embedding text comes from.
- [Parser specification](chunker/PARSER_SPEC.md): authoritative DOM selectors, chunk boundaries, fields, IDs, and text normalization rules.

## Important

- Keep the configured Pinecone index and embedding model aligned between upload and server query settings. See the [trainer guide](trainer/README.md#pinecone-and-embeddings).
- If chunk content changes, regenerate the chunks and refresh the embeddings; the [trainer guide](trainer/README.md#refreshing-the-index) covers the sequence.
- BABOK® is copyrighted by IIBA®. This project is for personal, non-commercial study only.
