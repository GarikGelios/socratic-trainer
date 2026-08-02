## Summary
The Pinecone index name is a hardcoded server constant (`ba-training-large`). Allow the user to select from multiple named indexes (knowledge bases) via a dropdown in the settings panel, with the server using the index specified in the request rather than the global CONFIG constant.

## Why (User Story)
As a **developer studying multiple subjects** (e.g. BABOK and the Scrum Guide stored in separate Pinecone indexes), I want to switch knowledge bases from the UI without restarting the server, so that I can use a single trainer instance for all my study materials and switch context instantly between topics.

## Acceptance Criteria
- [ ] Settings panel includes a "Knowledge Base" dropdown listing available indexes
- [ ] Available indexes defined in `trainer-config.json` as an `availableIndexes` array (name + display label)
- [ ] Each `/api/train/question`, `/api/train/evaluate`, and `/api/chat` request accepts an optional `indexName` field
- [ ] Server uses per-request `indexName` when provided, falls back to `CONFIG.indexName`
- [ ] Active knowledge base persisted in `localStorage` across page reloads
- [ ] Switching knowledge base resets the current training session automatically

## Files likely affected
- `trainer/server.js` — dynamic per-request Pinecone index selection
- `trainer/train.html` — knowledge base dropdown in settings panel
- `trainer/trainer-config.json` — new `availableIndexes` array field

## Copilot hint
In `server.js`, modify `retrieveContext()` to accept an `indexName` parameter and call `pc.index(indexName)` dynamically instead of using the module-level `index` constant. Pass `req.body.indexName || CONFIG.indexName` from each route handler.
