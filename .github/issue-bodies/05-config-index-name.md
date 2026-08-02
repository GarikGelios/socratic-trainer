## Summary
`trainer/trainer-config.json` sets `indexName: "babok-guide"` and `embeddingModel: "text-embedding-3-small"`, but the actual Pinecone index is `ba-training-large` using `text-embedding-3-large` (3072 dimensions). This config is loaded at startup and silently overrides the correct server defaults, causing all queries to fail with a dimension mismatch error.

## Why (User Story)
As a **developer running the server for the first time**, I want the configuration file to match the deployed Pinecone index, so that the server starts and serves questions without any manual file editing or debugging.

## Acceptance Criteria
- [ ] `trainer-config.json` `server.indexName` set to `"ba-training-large"`
- [ ] `trainer-config.json` `server.embeddingModel` set to `"text-embedding-3-large"`
- [ ] The `_comment` field updated to warn that these values must match the deployed Pinecone index

## Files likely affected
- `trainer/trainer-config.json`

## Copilot hint
Open `trainer/trainer-config.json` and update the `server` block. Change `indexName` from `"babok-guide"` to `"ba-training-large"` and `embeddingModel` from `"text-embedding-3-small"` to `"text-embedding-3-large"`.
