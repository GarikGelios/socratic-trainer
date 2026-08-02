## Summary
Add a settings panel in `train.html` where the user can view and edit the system prompt and per-level `promptInstruction` text directly in the browser, persisted to `localStorage` and sent with each API request.

## Why (User Story)
As a **student customising my training experience**, I want to edit the AI instructions directly in the UI without touching code or config files, so that I can tune question style, difficulty framing, and feedback depth to match my personal learning needs — and immediately see the effect on the next question without restarting the server.

## Acceptance Criteria
- [ ] Settings panel (gear icon already exists) extended with editable prompt text areas
- [ ] Fields: system prompt and one `promptInstruction` text area per level (1–6)
- [ ] Changes saved to `localStorage`; loaded and merged into each `/api/train/question` and `/api/train/evaluate` request body as `promptOverrides`
- [ ] Server accepts optional `promptOverrides` field in request body and uses it instead of stored defaults when present
- [ ] "Reset to defaults" button clears all `localStorage` prompt overrides
- [ ] No backend file writes required — client-side only

## Files likely affected
- `trainer/train.html` — extend existing `cfg-panel` modal, localStorage read/write
- `trainer/server.js` — accept `promptOverrides` in request body for `/api/train/question` and `/api/train/evaluate`

## Copilot hint
The settings gear button and `cfg-panel` modal already exist in `train.html`. Add prompt editing text areas inside the panel. In `server.js`, check `req.body.promptOverrides` before falling back to the `PROMPTS` / `COMPLEXITY_LEVELS` defaults in both the question and evaluate handlers.
