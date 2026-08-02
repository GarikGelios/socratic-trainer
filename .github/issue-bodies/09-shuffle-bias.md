## Summary
Level 1 multiple-choice options are shuffled using `.sort(() => Math.random() - 0.5)`. This is not a statistically uniform shuffle — certain positions are statistically favoured for the correct answer, creating a subtle pattern that undermines learning validity.

## Why (User Story)
As a **student practicing for the CBAP/CCBA exam**, I want answer options to be randomly shuffled with equal probability for each position, so that I cannot unconsciously learn positional patterns instead of actual BABOK knowledge — which would give me false confidence before the real exam.

## Acceptance Criteria
- [ ] Option shuffle replaced with a Fisher-Yates (Knuth) shuffle algorithm
- [ ] Correct answer has equal ~25% probability of landing in each of positions A, B, C, D
- [ ] No new dependencies required (pure JS implementation)

## Files likely affected
- `trainer/server.js` — Level 1 option shuffle block inside `POST /api/train/question`

## Copilot hint
Find the line `.sort(() => Math.random() - 0.5)` in the Level 1 parsing block. Replace with Fisher-Yates: iterate `i` from `arr.length - 1` down to `1`, pick `j = Math.floor(Math.random() * (i + 1))`, swap `arr[i]` and `arr[j]`.
