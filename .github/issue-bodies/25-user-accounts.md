## Summary
Add username + password authentication with JWT tokens so multiple users can each have their own session history, scores, and Pinecone namespaces — fully isolated from each other.

## Why (User Story)
As a **trainer sharing this tool with a study group**, I want each learner to have their own login, so that their training progress, weak topic reports, and uploaded knowledge bases are private and independent — and one student's activity cannot affect another's results or content.

## Acceptance Criteria
- [ ] `POST /api/auth/register` and `POST /api/auth/login` endpoints
- [ ] Passwords hashed with `bcrypt` — never stored in plain text
- [ ] JWT issued on login, required on all `/api/train/*` and `/api/chat` routes
- [ ] Session and question history in SQLite scoped to `userId`
- [ ] Pinecone namespaces prefixed with `userId` to isolate uploaded knowledge bases
- [ ] Login/register UI page or modal
- [ ] Depends on: Session persistence (SQLite) issue (#21)

## Files likely affected
- `trainer/server.js` — auth routes, JWT middleware
- `trainer/package.json` — add `bcrypt`, `jsonwebtoken`
- `trainer/data/sessions.db` — add `users` table

## Copilot hint
Add a `users` table to SQLite: `id, username, passwordHash`. On register, hash with `bcrypt.hash(password, 10)`. On login, verify with `bcrypt.compare`, then sign a JWT with `jsonwebtoken.sign({ userId }, process.env.JWT_SECRET)`. Add an `authMiddleware` function that verifies the Bearer token and attaches `req.userId` for all protected routes.
