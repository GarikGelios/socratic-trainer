## Summary
All BABOK-specific strings in the UI ("BABOK® Training", "Knowledge Area Tasks", "Technique", "Perspective", level descriptions) should come from a configurable labels JSON so the trainer can be rebranded for any domain without editing HTML files.

## Why (User Story)
As a **developer deploying this trainer for a non-BABOK domain** (e.g. PMP, AWS certifications, Scrum), I want all domain-specific UI text to be driven by a single config file, so that I can publish a correctly branded trainer for any subject by editing one JSON file — with no changes to the HTML source code required.

## Acceptance Criteria
- [ ] Create `trainer/ui-labels.json` with all current BABOK-specific strings as defaults
- [ ] Server exposes `GET /api/ui-labels` returning the active label set
- [ ] `train.html` and `chat.html` load labels from `GET /api/ui-labels` on startup and apply them to all relevant text nodes via `data-label` attributes
- [ ] UI labels editable in the settings panel with a live preview
- [ ] Strings "BABOK", "Knowledge Area", "Bloom's" no longer hardcoded in any HTML source

## Files likely affected
- `trainer/train.html`, `trainer/chat.html` — replace literals with `data-label="key"` attributes
- `trainer/server.js` — `GET /api/ui-labels` endpoint
- `trainer/ui-labels.json` — new file with label definitions

## Copilot hint
Audit `train.html` for all literal domain strings. Extract them into `ui-labels.json` with descriptive keys. Add `GET /api/ui-labels` route. In the HTML, add a `data-label="key"` attribute to each element containing a domain string, then add a JS function called on load that does `document.querySelectorAll('[data-label]').forEach(el => el.textContent = labels[el.dataset.label])`.
