## Summary
`trainer/pinecone-test.js` line 13 hardcodes `INDEX_NAME = 'ba-training'` — the original small index. The active index is `ba-training-large`. The test script always exits with "index not found".

## Why (User Story)
As a **developer setting up the project for the first time**, I want the connection test script to verify the actual active Pinecone index, so that I can confirm the setup is correct before running the full 42-minute embedding upload.

## Acceptance Criteria
- [ ] `INDEX_NAME` in `pinecone-test.js` updated to `'ba-training-large'`
- [ ] Running `node trainer/pinecone-test.js` with valid API keys reports success and shows correct vector count
- [ ] Optionally: read index name from `trainer-config.json` so it stays in sync automatically

## Files likely affected
- `trainer/pinecone-test.js`

## Copilot hint
Change line 13 in `pinecone-test.js` from `const INDEX_NAME = 'ba-training';` to `const INDEX_NAME = 'ba-training-large';`. One-line fix.
