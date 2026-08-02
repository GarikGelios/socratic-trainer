## Summary
Three packages have available updates: `openai` (6.32 → 6.48, 16 minor versions behind), `dotenv` (17.3.1 → 17.4.2), and `@pinecone-database/pinecone` has a major version bump to 8.0.0 available.

## Why (User Story)
As a **developer using the OpenAI and Pinecone SDKs**, I want to run on current versions, so that I have access to the latest model endpoints, SDK bug fixes, and security patches — without accumulating a large upgrade gap that becomes painful to close later.

## Acceptance Criteria
- [ ] `openai` updated to `^6.48.0`
- [ ] `dotenv` updated to `^17.4.2`
- [ ] `@pinecone-database/pinecone` v8 changelog reviewed; upgrade or document why pinned at v7
- [ ] All three endpoints (`/api/chat`, `/api/train/question`, `/api/train/evaluate`) tested after update
- [ ] `package.json` version ranges updated

## Files likely affected
- `trainer/package.json`, `trainer/package-lock.json`

## Copilot hint
Run `cd trainer && npm update openai dotenv`. For Pinecone v8, check the GitHub releases page for breaking changes before upgrading. Key things to look for: renamed client constructor, changed `upsert`/`query` method signatures.
