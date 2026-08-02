## Summary
`/api/chat`, `/api/train/question`, and `/api/train/evaluate` each trigger OpenAI API calls with no rate limiting. A single client can flood the server causing unbounded API cost.

## Why (User Story)
As a **developer paying for OpenAI API usage**, I want request rate limits enforced per IP address, so that accidental loops or malicious requests cannot generate unexpected charges.

## Acceptance Criteria
- [ ] Install `express-rate-limit` package
- [ ] Rate limiter applied to `/api/chat`, `/api/train/question`, `/api/train/evaluate`
- [ ] Default limit: 30 requests per minute per IP (configurable via `trainer-config.json`)
- [ ] Returns `429 Too Many Requests` with a human-readable message when exceeded

## Files likely affected
- `trainer/server.js` — add rate limiter middleware
- `trainer/package.json` — add `express-rate-limit` dependency

## Copilot hint
`npm install express-rate-limit` in `trainer/`. Import and apply `rateLimit({ windowMs: 60_000, max: 30 })` as middleware on the three POST routes in `server.js`.
