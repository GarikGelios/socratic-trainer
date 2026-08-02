## Summary
`POST /api/config` and `POST /api/prompts` endpoints have zero authentication — any HTTP client can overwrite system prompts, change the AI model, or alter evaluation scoring logic at runtime.

## Why (User Story)
As a **solo developer running this locally**, I want all admin endpoints to require a shared secret token, so that the AI evaluation logic and model settings cannot be tampered with by any script or browser tab that can reach the server.

## Acceptance Criteria
- [ ] `POST /api/config` and `POST /api/prompts` check for an `Authorization: Bearer <token>` header
- [ ] Token value is read from a new `ADMIN_TOKEN` environment variable in `.env`
- [ ] Requests without a valid token receive `401 Unauthorized`
- [ ] `GET /api/config` and `GET /api/prompts` remain public (read-only, no secrets exposed)
- [ ] `.env.example` documents the new variable

## Files likely affected
- `trainer/server.js` — add auth middleware for the two POST routes
- `.env` / `.env.example` — add `ADMIN_TOKEN`

## Copilot hint
Add a small Express middleware function before the POST route handlers in `server.js`. Read `process.env.ADMIN_TOKEN` and compare against the `Authorization` header. Return `401` if missing or mismatched.
