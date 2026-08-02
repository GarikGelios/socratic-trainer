## Summary
Replace random chunk selection with an SM-2 spaced repetition algorithm so chunks due for review are surfaced before new material, and review intervals grow automatically with demonstrated mastery.

## Why (User Story)
As a **student with limited daily study time**, I want the trainer to automatically schedule which topics to review and when — based on how well I answered them before — so that I spend time reviewing material just before I would naturally forget it, maximising long-term retention with the minimum effort per session.

## Acceptance Criteria
- [ ] Each chunk has an SM-2 record per session: `easeFactor`, `interval`, `repetitions`, `dueDate`
- [ ] On session start, chunks due today (`dueDate <= today`) are prioritised over new chunks
- [ ] Score >= 7 increases the interval according to SM-2 formula; score < 4 resets to interval = 1 (re-learn)
- [ ] `GET /api/train/due?sessionId=` returns count of chunks due for review today
- [ ] Due count shown in the trainer UI stats bar
- [ ] Depends on: Session persistence (SQLite) issue (#21)

## Files likely affected
- `trainer/server.js` — chunk selection logic in `POST /api/train/question`
- `trainer/data/sessions.db` — new `spaced_repetition` table (userId, chunkId, easeFactor, interval, repetitions, dueDate)

## Copilot hint
Add a `spaced_repetition` table to SQLite. In the question endpoint, run `SELECT chunkId FROM spaced_repetition WHERE sessionId=? AND dueDate <= date('now') ORDER BY dueDate LIMIT 20` before random selection. After evaluation, update the SM-2 record using the standard formula: if score >= 3, `interval = prev_interval * easeFactor`; if score < 3, `interval = 1`. Update `easeFactor += 0.1 - (5 - score) * 0.08`.
