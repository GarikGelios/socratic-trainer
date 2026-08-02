## Summary
The topic dropdown in `train.html` has hardcoded `<option>` tags with BABOK-specific values (`tasks`, `chapter:3`, `task:plan_ba_approach`, etc.). Move this list to a JSON config file loaded at server startup so the trainer works with any knowledge base without HTML changes.

## Why (User Story)
As a **developer adapting this trainer for a new domain** (e.g. Scrum Guide, AWS certification, PMP), I want the topic list to come from a config file rather than hardcoded HTML, so that I can deploy a correctly structured trainer for any subject by editing one JSON file — with zero changes to the UI source code.

## Acceptance Criteria
- [ ] Create `trainer/topic-config.json` with the current BABOK topic tree as default content
- [ ] Server exposes `GET /api/topics` returning the topic list from the JSON file
- [ ] `train.html` topic dropdown populated dynamically from `GET /api/topics` on page load
- [ ] No hardcoded `<option>` tags remain in `train.html` for the topic selector
- [ ] Existing topic filter logic in `server.js` (`chapter:`, `task:`, `tasks`, etc.) continues to work unchanged

## Files likely affected
- `trainer/train.html` — dynamic dropdown population via fetch
- `trainer/server.js` — new `GET /api/topics` endpoint
- `trainer/topic-config.json` — new file with topic tree definition

## Copilot hint
Add a `GET /api/topics` route in `server.js` that reads and returns `topic-config.json`. In `train.html`, replace the hardcoded `<select id="topic">` option tags with a `fetch('/api/topics')` call on `DOMContentLoaded` that builds `<option>` elements dynamically from the response array.
