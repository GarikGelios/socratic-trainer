# BABOK Chunk Generator

Converts the BABOK HTML files in `chunker/chapters/` into `embeddings-chunks.jsonl`, the structured input used by the trainer's embedding uploader.

## Generate Chunks

Install this module's dependencies once, then run the root project script:

```bash
npm install --prefix chunker
npm run chunk
```

The output is written to `chunker/embeddings-chunks.jsonl` regardless of the current working directory. The chunker needs Node.js but no API keys.

## How The Content Flows

1. The chunker reads chapter HTML and follows the documented DOM selectors and chunk boundaries.
2. It writes one JSON chunk per line. Each chunk has an `id`, `doc_type`, and a prebuilt `text` field, alongside structured metadata.
3. The uploader uses `chunk.text` as the text to embed, then uploads the vector and supported metadata to Pinecone.

For the full chunk-generation process and schema overview, see [PARSER_SPEC.md](PARSER_SPEC.md). It is the source of truth for how book text is selected, normalized, divided into chunks, and represented in `text`; update it before changing parser behavior. For upload and index operations, see the [trainer guide](../trainer/README.md).

## Inputs And Output

The expected source files are described in [PARSER_SPEC.md, section 1](PARSER_SPEC.md#1-source-file-inventory-and-schema-classification). Missing source files are skipped with a warning where the chunker supports that source family.

Generated output:

```text
chunker/embeddings-chunks.jsonl
```

Do not edit the generated JSONL by hand. Fix the source HTML or parser implementation, then regenerate it. BABOK® is copyrighted by IIBA®; this project is for personal, non-commercial study only.
