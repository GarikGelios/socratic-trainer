## Summary
After each training session, analyse per-chunk scores from session history and surface the topics where the student scores lowest — displayed as a "Topics to Review" panel in the trainer UI.

## Why (User Story)
As a **student preparing for a certification exam with limited time**, I want the trainer to automatically identify which topics I consistently answer poorly, so that I can focus my remaining study time on actual weak areas instead of topics I already know well — maximising exam readiness per hour of practice.

## Acceptance Criteria
- [ ] `GET /api/train/weakTopics?sessionId=` returns top 5 lowest-scoring chunk topics (minimum 2 attempts per topic)
- [ ] "Topics to Review" panel shown in trainer UI, updated after every 5th question
- [ ] Each entry shows: topic name, category, average score (X/10), and number of attempts
- [ ] Clicking a topic sets the topic filter to that specific task/technique automatically
- [ ] Depends on: Session persistence (SQLite) issue (#21)

## Files likely affected
- `trainer/server.js` — `GET /api/train/weakTopics` endpoint
- `trainer/train.html` — "Topics to Review" panel component

## Copilot hint
In `server.js`, add `GET /api/train/weakTopics`. Query the SQLite `questions` table: `SELECT chunkId, AVG(score) as avg, COUNT(*) as cnt FROM questions WHERE sessionId=? GROUP BY chunkId HAVING cnt >= 2 ORDER BY avg ASC LIMIT 5`. Join results with the in-memory `chunkMap` to get topic labels and categories for display.
