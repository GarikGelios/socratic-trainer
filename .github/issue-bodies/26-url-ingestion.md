## Summary
Allow the user to paste a URL and have the server fetch, extract readable text, chunk it, and index it into a named knowledge base — extending the file upload pipeline to any web content.

## Why (User Story)
As a **student studying from online documentation** (official framework docs, Wikipedia articles, online guides), I want to paste a URL and have it automatically added to my knowledge base, so that I can train on any web content without downloading or converting files manually — making the tool useful for any publicly accessible study material.

## Acceptance Criteria
- [ ] `POST /api/kb/ingest-url` accepts a URL and optional knowledge base name
- [ ] Server fetches URL content using Node's built-in `fetch`
- [ ] Readable article text extracted using `@mozilla/readability` + `jsdom`
- [ ] Extracted text chunked and embedded using the same pipeline as file upload
- [ ] Progress feedback returned to UI (same pattern as file upload)
- [ ] JS-rendered pages documented as a known limitation (static pages only without Playwright)
- [ ] Depends on: File upload issue (#18)

## Files likely affected
- `trainer/server.js` — `POST /api/kb/ingest-url`
- `trainer/package.json` — add `@mozilla/readability`, `jsdom`
- `trainer/train.html` — URL input form in upload UI

## Copilot hint
Use `fetch(url)` to get HTML, then `new JSDOM(html)` and `new Readability(dom.window.document).parse()` to extract clean article text and title. Pass the extracted text through the same chunking and embedding helper created for the file upload feature. Validate the URL input is a valid HTTP/HTTPS URL before fetching.
