## Summary
After a document is uploaded and chunked, display the detected heading hierarchy so the user can confirm or rename it. The confirmed structure becomes the entries in the topic dropdown for that knowledge base.

## Why (User Story)
As a **student uploading a new textbook**, I want to see the chapter and section structure detected from my document and be able to confirm or rename it, so that the topic filter in the trainer reflects the actual organisation of my study material — not a generic flat list.

## Acceptance Criteria
- [ ] After upload, server returns detected heading hierarchy (H1/H2/H3 levels from the document)
- [ ] UI shows the heading tree with checkboxes to include/exclude each section
- [ ] User can rename any heading before confirming
- [ ] Confirmed structure saved as the `topic-config.json` for that knowledge base
- [ ] Topic dropdown populated from confirmed structure on next session start
- [ ] Depends on: File upload (#18) and Generic topic taxonomy (#16) issues

## Files likely affected
- `trainer/server.js` — heading extraction during upload
- `trainer/train.html` — heading review UI step after upload completes

## Copilot hint
During chunking in `POST /api/kb/upload`, collect all headings with their nesting level and return them as a `headings` array in the upload response. In the UI, render the array as a collapsible tree with checkboxes. On confirm, POST the edited structure back as the new topic config for that knowledge base.
