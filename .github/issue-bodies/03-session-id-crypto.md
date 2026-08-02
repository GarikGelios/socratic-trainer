## Summary
`generateSessionId()` uses `Date.now().toString(36) + Math.random().toString(36)` — predictable and enumerable. An attacker could guess or brute-force another user's session ID.

## Why (User Story)
As a **developer building a reliable training tool**, I want session identifiers to be cryptographically unpredictable, so that training progress and question state cannot be hijacked by guessing a session ID.

## Acceptance Criteria
- [ ] Replace `generateSessionId()` with `crypto.randomUUID()` (Node 14.17+ built-in, no new dependency)
- [ ] All existing callers continue to work without change
- [ ] Session IDs returned to clients are UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## Files likely affected
- `trainer/server.js` — `generateSessionId()` function near the bottom of the file

## Copilot hint
Find `generateSessionId()` near the bottom of `server.js`. Replace the body with `return require('crypto').randomUUID();` — or add `const { randomUUID } = require('crypto');` at the top of the file.
