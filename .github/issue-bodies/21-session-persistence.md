## Summary
Replace the in-memory `trainSessions` Map with a SQLite database so training history, scores, and level progress survive server restarts and are available for analytics and spaced repetition.

## Why (User Story)
As a **student in a multi-day study programme**, I want my training progress (questions answered, scores per topic, current level) to persist between sessions and server restarts, so that I can continue exactly where I left off the next day — and review my complete historical performance to understand my learning curve.

## Acceptance Criteria
- [ ] Add `better-sqlite3` dependency
- [ ] Database stored at `trainer/data/sessions.db` (directory added to `.gitignore`)
- [ ] Tables: `sessions` (id, level, lastAccessedAt), `questions` (sessionId, chunkId, question, answer, score, level, aspect, timestamp)
- [ ] `GET /api/train/history?sessionId=` returns past questions and scores for a session
- [ ] On new `/api/train/question` request with existing `sessionId`, restore level and stats from DB
- [ ] In-memory Map remains as write-through cache for performance; DB is source of truth on restart
- [ ] This issue is the foundation for: weak topic detection (#22) and spaced repetition (#24)

## Files likely affected
- `trainer/server.js` — session read/write
- `trainer/package.json` — add `better-sqlite3`
- `trainer/data/` — new directory

## Copilot hint
Create `trainer/db.js` that opens/initialises `sessions.db` using `better-sqlite3` and exports prepared statements. Call `db.saveQuestion(...)` inside the evaluate endpoint after scoring, and `db.getSession(sid)` at the start of the question endpoint to restore level and stats.
