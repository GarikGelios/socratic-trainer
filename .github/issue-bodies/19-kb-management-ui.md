## Summary
Add a Knowledge Bases management screen that lists all available Pinecone indexes/namespaces with their vector count, and allows the user to delete a knowledge base they no longer need.

## Why (User Story)
As a **developer managing multiple study indexes in Pinecone**, I want a UI to see what knowledge bases exist, how many vectors each contains, and delete ones I no longer need, so that I can keep the Pinecone index clean and avoid paying for unused stored vectors.

## Acceptance Criteria
- [ ] `GET /api/kb/list` returns all configured knowledge bases with name, description, and vector count from Pinecone stats API
- [ ] Management UI (accessible from settings panel) shows a table: Name | Vectors | Actions
- [ ] Delete button calls Pinecone `deleteAll` on the namespace and removes the entry from config
- [ ] Confirmation dialog required before delete to prevent accidental data loss
- [ ] Depends on: "Multiple named knowledge bases" issue (#17)

## Files likely affected
- `trainer/server.js` — `GET /api/kb/list`, `DELETE /api/kb/:name`
- `trainer/train.html` — KB management panel inside settings

## Copilot hint
Use `pc.index(indexName).describeIndexStats()` to get per-namespace vector counts. Add `DELETE /api/kb/:name` that calls `pc.index(indexName).deleteAll({ namespace: name })` and removes the entry from `trainer-config.json`'s `availableIndexes` array.
