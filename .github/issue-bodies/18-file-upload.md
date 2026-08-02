## Summary
Add a drag-and-drop file upload form (PDF, TXT) that extracts text, splits it into chunks, generates embeddings, and upserts to a named Pinecone namespace — all from the browser UI, with no command-line scripts required.

## Why (User Story)
As a **student with a new study book in PDF or text format**, I want to upload it through the UI and have it automatically indexed for training, so that I can start practising with my own material in minutes — without running any command-line scripts, writing code, or understanding the embedding pipeline.

## Acceptance Criteria
- [ ] Upload UI: drag-drop zone or file picker accepting PDF and TXT
- [ ] Server endpoint `POST /api/kb/upload` extracts text (`pdf-parse` for PDF, plain read for TXT)
- [ ] Text split into chunks of ~1200 tokens with ~20% overlap
- [ ] Chunks embedded with the configured embedding model and upserted to a named Pinecone namespace
- [ ] Upload progress shown in UI (polling or Server-Sent Events)
- [ ] On completion, new knowledge base appears in the KB list and topic dropdown
- [ ] Depends on: "Multiple named knowledge bases" issue (#17)

## Files likely affected
- `trainer/server.js` — `POST /api/kb/upload` route
- `trainer/train.html` — upload UI component
- `trainer/package.json` — add `multer`, `pdf-parse`

## Copilot hint
Create `POST /api/kb/upload` using `multer` for multipart file handling. Extract text with `pdf-parse` for PDFs. Reuse the chunking and embedding logic already in `pinecone-upload.js` — extract it into a shared helper function. Stream progress updates back to the UI with Server-Sent Events.
