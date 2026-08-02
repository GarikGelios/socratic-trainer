## Summary
`sessions` and `trainSessions` Maps grow indefinitely. Every browser visit or API call that creates a session leaves it in memory forever. A long-running server will eventually exhaust RAM.

## Why (User Story)
As a **developer keeping the server running continuously**, I want stale sessions to be cleaned up automatically, so that the server does not run out of memory after days of use.

## Acceptance Criteria
- [ ] Each session entry stores a `lastAccessedAt` timestamp, updated on every request that touches it
- [ ] A `setInterval` runs every 30 minutes and deletes sessions not accessed in the last 2 hours
- [ ] TTL duration is configurable via `trainer-config.json` (`sessionTTLMinutes`, default: 120)
- [ ] Cleanup is logged: `[session] Cleaned N expired sessions`

## Files likely affected
- `trainer/server.js` — session creation, access touch, and new cleanup interval

## Copilot hint
Add `lastAccessedAt: Date.now()` when sessions are created and update it in each request handler. Add a `setInterval` at the bottom of `server.js` that iterates both `sessions` and `trainSessions` Maps and calls `.delete()` on entries where `Date.now() - lastAccessedAt` exceeds the TTL.
