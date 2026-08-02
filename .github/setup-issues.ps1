
# ============================================================
# GitHub Issues Setup Script for socratic-trainer
# Run from repo root: .\\.github\\setup-issues.ps1
# Requires: gh CLI authenticated (gh auth login)
# ============================================================

$REPO = "GarikGelios/socratic-trainer"

Write-Host "`n=== STEP 1: Labels ===" -ForegroundColor Cyan

$labels = @(
  @{ name="security";      color="B60205"; description="Security vulnerability or auth gap" },
  @{ name="tech-debt";     color="E4E669"; description="Code quality, legacy patterns, mixed style" },
  @{ name="dependencies";  color="F9D0C4"; description="Outdated or vulnerable packages" },
  @{ name="tier-1";        color="0E8A16"; description="High impact, low complexity - do first" },
  @{ name="tier-2";        color="5319E7"; description="High impact, medium complexity" },
  @{ name="tier-3";        color="1D76DB"; description="Medium impact, medium complexity" },
  @{ name="tier-4";        color="C5DEF5"; description="High complexity, strategic - after validation" }
)

foreach ($l in $labels) {
  Write-Host "  Creating label: $($l.name)"
  gh label create $l.name --color $l.color --description $l.description --repo $REPO 2>&1 | Out-Null
}

Write-Host "`n=== STEP 2: Milestones ===" -ForegroundColor Cyan

$milestones = @(
  @{ title="v1.0 — Security & Stability";      description="All security issues and configuration bugs — must fix before sharing with anyone." },
  @{ title="Phase 1 — Generic Foundation";     description="Tier 1 features: configurable prompts UI, generic topic taxonomy, multiple named indexes." },
  @{ title="Phase 2 — Content Pipeline";       description="Tier 2 features: file/PDF upload, KB management UI, custom TOC from headings." },
  @{ title="Phase 3 — Learning Intelligence";  description="Tier 3 features: session persistence (SQLite), weak topic detection, generic UI labels." },
  @{ title="Phase 4 — Multi-user & Strategic"; description="Tier 4 features: user accounts, spaced repetition, URL ingestion." }
)

foreach ($m in $milestones) {
  Write-Host "  Creating milestone: $($m.title)"
  gh api repos/$REPO/milestones --method POST `
    --field title="$($m.title)" `
    --field description="$($m.description)" `
    --field state="open" 2>&1 | Out-Null
}

Write-Host "`n=== STEP 3: Issues — v1.0 Security & Stability ===" -ForegroundColor Cyan

# Helper: get milestone number by title
function Get-MilestoneNumber($title) {
  $ms = gh api repos/$REPO/milestones --jq ".[] | select(.title == \"$title\") | .number" 2>&1
  return $ms.Trim()
}

$ms_v1     = Get-MilestoneNumber "v1.0 — Security & Stability"
$ms_phase1 = Get-MilestoneNumber "Phase 1 — Generic Foundation"
$ms_phase2 = Get-MilestoneNumber "Phase 2 — Content Pipeline"
$ms_phase3 = Get-MilestoneNumber "Phase 3 — Learning Intelligence"
$ms_phase4 = Get-MilestoneNumber "Phase 4 — Multi-user & Strategic"

Write-Host "  Milestone IDs: v1=$ms_v1, p1=$ms_phase1, p2=$ms_phase2, p3=$ms_phase3, p4=$ms_phase4"

# ── v1.0 Issues ──────────────────────────────────────────────────────────────

$issues_v1 = @(

@{
  title = "[security] No authentication on POST /api/config and POST /api/prompts"
  labels = "security,bug"
  body = @"
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
- `trainer/server.js` — add auth middleware for POST routes
- `.env` / `.env.example` — add `ADMIN_TOKEN`

## Copilot hint
Add a small Express middleware function before the two POST route handlers in `server.js`. Read `process.env.ADMIN_TOKEN` and compare against the `Authorization` header value.
"@
},

@{
  title = "[security] No rate limiting on OpenAI-triggering API endpoints"
  labels = "security,bug"
  body = @"
## Summary
`/api/chat`, `/api/train/question`, and `/api/train/evaluate` each call the OpenAI API with no rate limiting. A single client can flood the server causing unbounded API cost.

## Why (User Story)
As a **developer paying for OpenAI API usage**, I want request rate limits enforced per IP address, so that accidental loops or malicious requests cannot generate unexpected charges.

## Acceptance Criteria
- [ ] Install `express-rate-limit` package
- [ ] Apply a rate limiter to `/api/chat`, `/api/train/question`, `/api/train/evaluate`
- [ ] Default limit: 30 requests per minute per IP (configurable via `trainer-config.json`)
- [ ] Returns `429 Too Many Requests` with a human-readable message when exceeded

## Files likely affected
- `trainer/server.js` — add rate limiter middleware
- `trainer/package.json` — add `express-rate-limit` dependency

## Copilot hint
`npm install express-rate-limit` then import and apply `rateLimit({ windowMs: 60_000, max: 30 })` as middleware on the three POST routes in `server.js`.
"@
},

@{
  title = "[security] Session IDs are not cryptographically random"
  labels = "security,tech-debt"
  body = @"
## Summary
`generateSessionId()` uses `Date.now().toString(36) + Math.random().toString(36)` — predictable and enumerable. An attacker could guess or brute-force another user's session ID.

## Why (User Story)
As a **developer building a reliable training tool**, I want session identifiers to be cryptographically unpredictable, so that training progress and question state cannot be hijacked by guessing a session ID.

## Acceptance Criteria
- [ ] Replace `generateSessionId()` with `crypto.randomUUID()` (Node 14.17+ built-in, no new dependency)
- [ ] All existing callers of `generateSessionId()` continue to work without change
- [ ] Session IDs returned to clients are UUIDs (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)

## Files likely affected
- `trainer/server.js` — `generateSessionId()` function

## Copilot hint
Find `generateSessionId()` near the bottom of `server.js`. Replace the body with `return require('crypto').randomUUID();` — or import `crypto` at the top of the file.
"@
},

@{
  title = "[security] In-memory sessions have no TTL — unbounded memory growth"
  labels = "security,bug"
  body = @"
## Summary
`sessions` and `trainSessions` Maps grow indefinitely. Every browser visit or API call that creates a session leaves it in memory forever. A long-running server will eventually exhaust RAM.

## Why (User Story)
As a **developer keeping the server running continuously**, I want stale sessions to be cleaned up automatically, so that the server does not run out of memory after days of use.

## Acceptance Criteria
- [ ] Each session entry stores a `lastAccessedAt` timestamp, updated on every request
- [ ] A `setInterval` runs every 30 minutes and deletes sessions not accessed in the last 2 hours
- [ ] TTL duration is configurable via `trainer-config.json` (`sessionTTLMinutes`, default: 120)
- [ ] Cleanup is logged: `[session] Cleaned N expired sessions`

## Files likely affected
- `trainer/server.js` — session creation, access, and new cleanup interval

## Copilot hint
Add a `lastAccessedAt: Date.now()` field when sessions are created/updated in `trainSessions`. Add a `setInterval` at the bottom of `server.js` that iterates both Maps and deletes entries where `Date.now() - lastAccessedAt > TTL`.
"@
},

@{
  title = "[bug] trainer-config.json overrides indexName and embeddingModel to wrong values — breaks Pinecone on startup"
  labels = "bug"
  body = @"
## Summary
`trainer/trainer-config.json` sets `indexName: "babok-guide"` and `embeddingModel: "text-embedding-3-small"`, but the actual Pinecone index is `ba-training-large` using `text-embedding-3-large` (3072 dimensions). This config is loaded at startup and silently overrides the correct server defaults, causing all queries to fail.

## Why (User Story)
As a **developer running the server for the first time**, I want the configuration file to match the deployed Pinecone index, so that the server starts and serves questions without any manual file editing.

## Acceptance Criteria
- [ ] `trainer-config.json` `server.indexName` set to `"ba-training-large"`
- [ ] `trainer-config.json` `server.embeddingModel` set to `"text-embedding-3-large"`
- [ ] The `_comment` field is updated to warn that these values must match the deployed Pinecone index

## Files likely affected
- `trainer/trainer-config.json`

## Copilot hint
Open `trainer/trainer-config.json` and update the `server` block. Change `indexName` and `embeddingModel` to match the values hardcoded in `server.js` CONFIG defaults.
"@
},

@{
  title = "[bug] trainer-config.json level names mismatch server.js — wrong names shown in UI"
  labels = "bug"
  body = @"
## Summary
`trainer-config.json` uses old Bloom's Taxonomy names (Knowledge, Comprehension, Application, Analysis, Synthesis, Evaluation) for levels 1–6. `server.js` uses custom names (Recognition, Multi-Select, Understanding, Application, Analysis, Synthesis). The config is loaded at startup and overrides the server defaults, so the UI shows wrong level names.

## Why (User Story)
As a **student using the trainer**, I want the level names in the UI to match the README and the actual question format, so that I understand what type of question to expect at each level.

## Acceptance Criteria
- [ ] `trainer-config.json` level names updated to match `server.js`: Recognition, Multi-Select, Understanding, Application, Analysis, Synthesis
- [ ] Or — level name overrides removed from `trainer-config.json` entirely so server defaults always win
- [ ] UI level badge and level description match the README table

## Files likely affected
- `trainer/trainer-config.json`

## Copilot hint
In `trainer-config.json`, update the `levels` block: level 1 → "Recognition", 2 → "Multi-Select", 3 → "Understanding", 4 → "Application", 5 → "Analysis", 6 → "Synthesis". Or delete the name fields to let `server.js` defaults win.
"@
},

@{
  title = "[bug] pinecone-test.js hardcoded to old index 'ba-training' — always reports not found"
  labels = "bug"
  body = @"
## Summary
`trainer/pinecone-test.js` line 13 hardcodes `INDEX_NAME = 'ba-training'` — the original small index. The active index is `ba-training-large`. The test script always exits with "index not found".

## Why (User Story)
As a **developer setting up the project for the first time**, I want the connection test script to verify the actual active Pinecone index, so that I can confirm the setup is correct before running the full upload.

## Acceptance Criteria
- [ ] `INDEX_NAME` in `pinecone-test.js` updated to `'ba-training-large'`
- [ ] Or — read from the same `trainer-config.json` so it stays in sync automatically
- [ ] Running `node trainer/pinecone-test.js` with valid API keys reports success and correct vector count

## Files likely affected
- `trainer/pinecone-test.js`

## Copilot hint
Change line 13 in `pinecone-test.js`: `const INDEX_NAME = 'ba-training-large';`
"@
},

@{
  title = "[bug] pinecone-query.js has garbled UTF-8 encoding — emoji display as mojibake"
  labels = "bug,tech-debt"
  body = @"
## Summary
`trainer/pinecone-query.js` was saved with incorrect encoding. All emoji characters appear as garbled multi-byte sequences (e.g. `вќЊ` instead of `❌`, `рџ"Ќ` instead of `🔍`). The script still runs but console output is unreadable.

## Why (User Story)
As a **developer debugging RAG query results in the terminal**, I want the query script output to display clean readable emoji and text, so that I can quickly scan retrieval scores and errors without decoding mojibake.

## Acceptance Criteria
- [ ] All garbled sequences replaced with correct Unicode emoji
- [ ] File saved as UTF-8 (with or without BOM — must render correctly in Windows terminal and VS Code)
- [ ] `node trainer/pinecone-query.js "test"` output shows clean `❌`, `🔍`, `📎`, `═`, `─` characters

## Files likely affected
- `trainer/pinecone-query.js`

## Copilot hint
Do a find-and-replace of all `вќЊ` → `❌`, `рџ"Ќ` → `🔍`, `рџ"Ў` → `📎`, `в"Ђ` → `─`, `в•ђ` → `═`, `вљ пёЏ` → `⚠️`, `вњ…` → `✅`. Then re-save the file explicitly as UTF-8.
"@
},

@{
  title = "[bug] MC option shuffle uses Math.random sort — positional bias in answer placement"
  labels = "bug"
  body = @"
## Summary
Level 1 multiple-choice options are shuffled using `.sort(() => Math.random() - 0.5)`. This is not a statistically uniform shuffle — certain positions are favoured for the correct answer, creating a subtle but measurable pattern that undermines learning validity.

## Why (User Story)
As a **student practicing for the CBAP/CCBA exam**, I want answer options to be randomly shuffled with equal probability for each position, so that I cannot unconsciously learn positional patterns instead of actual BABOK knowledge.

## Acceptance Criteria
- [ ] Option shuffle replaced with a Fisher-Yates algorithm
- [ ] Correct answer has equal probability of landing in positions A, B, C, or D across many questions
- [ ] No new dependencies required (pure JS implementation)

## Files likely affected
- `trainer/server.js` — inside `POST /api/train/question`, the Level 1 option shuffle block

## Copilot hint
Find the line `.sort(() => Math.random() - 0.5)` in the Level 1 parsing block of `/api/train/question`. Replace with a Fisher-Yates shuffle: iterate from the last element down, swap with a random earlier element.
"@
},

@{
  title = "[dependencies] HIGH CVE: path-to-regexp DoS vulnerability via Express 5 transitive dependency"
  labels = "security,dependencies"
  body = @"
## Summary
`npm audit` reports a HIGH severity DoS vulnerability in `path-to-regexp@8.x` (GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7), which is a transitive dependency of `express@5.x`. A malicious URL pattern can cause catastrophic backtracking in the regex engine, hanging the server.

## Why (User Story)
As a **developer exposing this server on any network**, I want known CVEs in transitive dependencies to be patched, so that the server cannot be taken offline by a crafted HTTP request.

## Acceptance Criteria
- [ ] `npm audit fix` run in `trainer/` resolves both path-to-regexp CVEs
- [ ] `npm audit` reports zero high-severity vulnerabilities after fix
- [ ] All existing API endpoints continue to function after the dependency update

## Files likely affected
- `trainer/package.json`, `trainer/package-lock.json`

## Copilot hint
Run `cd trainer && npm audit fix` — this should auto-resolve both CVEs. Then run `npm audit` again to confirm zero high findings. If `npm audit fix` cannot resolve without breaking changes, consider downgrading to `express@^4.21` (stable LTS).
"@
},

@{
  title = "[dependencies] MODERATE CVE: qs DoS vulnerability via Express 5 transitive dependency"
  labels = "security,dependencies"
  body = @"
## Summary
`npm audit` reports a MODERATE severity DoS in `qs@6.11–6.15` (GHSA-q8mj-m7cp-5q26), also a transitive dependency of Express 5. `qs.stringify` crashes with `TypeError` on certain input shapes when `encodeValuesOnly` is set.

## Why (User Story)
As a **developer maintaining dependency hygiene**, I want all moderate+ CVEs resolved, so that the project dependency tree is clean and no known exploitable crashes exist in request parsing.

## Acceptance Criteria
- [ ] `npm audit fix` in `trainer/` resolves the qs vulnerability
- [ ] `npm audit` reports zero moderate+ vulnerabilities after fix
- [ ] POST request body parsing continues to work correctly for all endpoints

## Files likely affected
- `trainer/package.json`, `trainer/package-lock.json`

## Copilot hint
This is typically resolved as part of the same `npm audit fix` run that fixes path-to-regexp. Run both together: `cd trainer && npm audit fix && npm audit`.
"@
},

@{
  title = "[dependencies] Update openai, dotenv, and evaluate @pinecone-database/pinecone v8"
  labels = "dependencies"
  body = @"
## Summary
Three packages have available updates: `openai` (6.32 → 6.48, 16 minor versions behind), `dotenv` (17.3.1 → 17.4.2), and `@pinecone-database/pinecone` has a major version bump to 8.0.0.

## Why (User Story)
As a **developer using the OpenAI and Pinecone SDKs**, I want to run on current minor/patch versions, so that I have access to the latest model endpoints, bug fixes, and SDK improvements without accumulating a large upgrade gap.

## Acceptance Criteria
- [ ] `openai` updated to `^6.48.0`
- [ ] `dotenv` updated to `^17.4.2`
- [ ] `@pinecone-database/pinecone` changelog reviewed for v8 breaking changes — upgrade or document why pinned
- [ ] All three endpoints (`/api/chat`, `/api/train/question`, `/api/train/evaluate`) tested after update
- [ ] `package.json` version ranges updated accordingly

## Files likely affected
- `trainer/package.json`, `trainer/package-lock.json`

## Copilot hint
Run `cd trainer && npm update openai dotenv`. For Pinecone v8, first run `npm show @pinecone-database/pinecone@8 changelog` or check the GitHub releases page before upgrading — it may have renamed methods.
"@
},

@{
  title = "[tech-debt] root package.json has no node_modules — npm start from repo root fails"
  labels = "tech-debt"
  body = @"
## Summary
The root `package.json` defines `scripts.start` as `node trainer/server.js` but has no `dependencies` and no `node_modules`. Running `npm start` from the repo root fails because `express`, `openai`, etc. are only installed in `trainer/node_modules`.

## Why (User Story)
As a **developer cloning this repo for the first time**, I want `npm install && npm start` from the project root to work, so that I can get the server running without reading internal module structure or navigating to subdirectories.

## Acceptance Criteria
- [ ] Either: convert root to an npm workspace (`workspaces: ["chunker", "trainer"]`) so `npm install` at root installs all deps
- [ ] Or: `README.md` Quick Start updated to clearly state `cd trainer && npm install && npm start`
- [ ] `npm start` from the correct location succeeds after a clean `npm install`

## Files likely affected
- `package.json` (root)
- `README.md`

## Copilot hint
Add `"workspaces": ["chunker", "trainer"]` to root `package.json` and add `"private": true`. Then run `npm install` from root to verify both submodule deps are hoisted correctly.
"@
},

@{
  title = "[tech-debt] Mixed var/const/let coding style in server.js config loader"
  labels = "tech-debt"
  body = @"
## Summary
The `loadExternalConfig` IIFE in `server.js` uses `var` declarations and `function` keyword expressions while the rest of the file consistently uses `const`/`let` and arrow functions. This creates cognitive friction when reading and modifying the config loading code.

## Why (User Story)
As a **developer maintaining server.js**, I want a consistent modern JavaScript style throughout the file, so that I can read and modify any section without switching mental models between ES5 and ES2015+ syntax.

## Acceptance Criteria
- [ ] All `var` declarations in `loadExternalConfig` replaced with `const` or `let`
- [ ] `function` keyword callbacks replaced with arrow functions where appropriate
- [ ] No behaviour change — only syntax modernisation
- [ ] ESLint or manual review confirms no remaining `var` in `server.js`

## Files likely affected
- `trainer/server.js` — `loadExternalConfig` IIFE (~line 260)

## Copilot hint
Search `server.js` for `var ` — all occurrences are inside the `loadExternalConfig` IIFE. Replace `var ext` with `const ext`, `var cfgPath` with `const cfgPath`, etc. Replace `function(k)` callbacks with `(k) =>`.
"@
}
)

foreach ($issue in $issues_v1) {
  Write-Host "  Creating: $($issue.title.Substring(0, [Math]::Min(60, $issue.title.Length)))..."
  $tmpFile = [System.IO.Path]::GetTempFileName()
  $issue.body | Out-File -FilePath $tmpFile -Encoding utf8
  gh issue create `
    --repo $REPO `
    --title $issue.title `
    --label $issue.labels `
    --milestone "v1.0 — Security & Stability" `
    --body-file $tmpFile
  Remove-Item $tmpFile
}

Write-Host "`n=== STEP 4: Issues — Phase 1 Generic Foundation ===" -ForegroundColor Cyan

$issues_p1 = @(

@{
  title = "[feature] Configurable trainer prompts in settings UI"
  labels = "enhancement,tier-1"
  body = @"
## Summary
Add a settings panel in `train.html` where the user can view and edit the system prompt and per-level `promptInstruction` text directly in the browser, persisted to `localStorage` and sent with each API request.

## Why (User Story)
As a **student customising the training experience**, I want to edit the AI instructions directly in the UI without touching code or config files, so that I can tune question style, difficulty framing, and feedback depth to match my learning needs — and immediately see the effect on the next question.

## Acceptance Criteria
- [ ] Settings panel (gear icon) in trainer header opens a modal with editable prompt fields
- [ ] Fields: system prompt, and one `promptInstruction` text area per level (1–6)
- [ ] Changes saved to `localStorage`; loaded and merged into each `/api/train/question` and `/api/train/evaluate` request
- [ ] Server accepts optional `promptOverrides` field in request body and uses it instead of stored defaults
- [ ] "Reset to defaults" button clears `localStorage` overrides
- [ ] No backend file writes — client-side only

## Files likely affected
- `trainer/train.html` — settings modal, localStorage read/write
- `trainer/server.js` — accept `promptOverrides` in request body

## Copilot hint
The settings gear button already exists in `train.html`. Extend the existing `cfg-panel` modal to add prompt editing fields. In `server.js`, check `req.body.promptOverrides` before falling back to the `PROMPTS` / `COMPLEXITY_LEVELS` defaults.
"@
},

@{
  title = "[feature] Generic topic taxonomy — load topic dropdown from JSON config, remove BABOK hardcoding"
  labels = "enhancement,tier-1"
  body = @"
## Summary
The topic dropdown in `train.html` has hardcoded `<option>` tags with BABOK-specific values (`tasks`, `chapter:3`, `task:plan_ba_approach`, etc.). Move this list to a JSON config file loaded at server startup so the trainer works with any knowledge base.

## Why (User Story)
As a **developer adapting this trainer for a new domain** (e.g. Scrum Guide, AWS certification), I want the topic list to come from a config file rather than hardcoded HTML, so that I can deploy a customised trainer for any subject by editing one JSON file — without touching the UI source code.

## Acceptance Criteria
- [ ] Create `trainer/topic-config.json` with the current BABOK topic tree as the default
- [ ] Server exposes `GET /api/topics` returning the topic list from the JSON file
- [ ] `train.html` topic dropdown populated dynamically from `GET /api/topics` on page load
- [ ] No hardcoded `<option>` tags remain in `train.html`
- [ ] Existing topic filter logic in `server.js` (`chapter:`, `task:`, `tasks`, etc.) continues to work

## Files likely affected
- `trainer/train.html` — dynamic dropdown population
- `trainer/server.js` — `GET /api/topics` endpoint
- `trainer/topic-config.json` — new file with topic definitions

## Copilot hint
Add a `GET /api/topics` route in `server.js` that reads and returns `topic-config.json`. In `train.html`, replace the hardcoded `<select id="topic">` options with a `fetch('/api/topics')` call on `DOMContentLoaded` that builds `<option>` elements dynamically.
"@
},

@{
  title = "[feature] Multiple named knowledge bases — switch active index from UI"
  labels = "enhancement,tier-1"
  body = @"
## Summary
The Pinecone index name is a hardcoded server constant (`ba-training-large`). Allow the user to select from multiple named indexes (knowledge bases) via a dropdown in the settings panel, with the server reading `indexName` from the request rather than from the static `CONFIG`.

## Why (User Story)
As a **developer studying multiple subjects** (e.g. BABOK and the Scrum Guide in separate Pinecone indexes), I want to switch knowledge bases from the UI without restarting the server, so that I can use one trainer instance for all my study materials.

## Acceptance Criteria
- [ ] Settings panel includes a "Knowledge Base" dropdown listing available indexes
- [ ] Available indexes defined in `trainer-config.json` as an array (`availableIndexes`)
- [ ] Each `/api/train/question`, `/api/train/evaluate`, and `/api/chat` request accepts an optional `indexName` field
- [ ] Server uses per-request `indexName` when provided, falls back to `CONFIG.indexName`
- [ ] Active knowledge base persisted in `localStorage`
- [ ] Switching knowledge base resets the current training session

## Files likely affected
- `trainer/server.js` — per-request Pinecone index selection
- `trainer/train.html` — knowledge base dropdown in settings
- `trainer/trainer-config.json` — `availableIndexes` array

## Copilot hint
In `server.js`, modify `retrieveContext()` to accept an `indexName` parameter and call `pc.index(indexName)` dynamically instead of using the module-level `index` constant. Pass `req.body.indexName || CONFIG.indexName` to this function from each route handler.
"@
}
)

foreach ($issue in $issues_p1) {
  Write-Host "  Creating: $($issue.title.Substring(0, [Math]::Min(60, $issue.title.Length)))..."
  $tmpFile = [System.IO.Path]::GetTempFileName()
  $issue.body | Out-File -FilePath $tmpFile -Encoding utf8
  gh issue create `
    --repo $REPO `
    --title $issue.title `
    --label $issue.labels `
    --milestone "Phase 1 — Generic Foundation" `
    --body-file $tmpFile
  Remove-Item $tmpFile
}

Write-Host "`n=== STEP 5: Issues — Phase 2 Content Pipeline ===" -ForegroundColor Cyan

$issues_p2 = @(

@{
  title = "[feature] File/PDF upload → auto-chunk → upload to Pinecone"
  labels = "enhancement,tier-2"
  body = @"
## Summary
Add a drag-and-drop file upload form (PDF, EPUB, TXT) that extracts text, splits it into chunks, generates embeddings, and upserts to a named Pinecone namespace — all from the browser UI.

## Why (User Story)
As a **student with a new study book** (PDF, EPUB, or plain text), I want to upload it through the UI and have it automatically indexed for training, so that I can start practising with my own material in minutes — without running any command-line scripts or writing code.

## Acceptance Criteria
- [ ] Upload UI: drag-drop zone or file picker accepting PDF, TXT, EPUB
- [ ] Server endpoint `POST /api/kb/upload` extracts text (use `pdf-parse` for PDF, plain read for TXT)
- [ ] Text split into chunks of ~1200 tokens with overlap
- [ ] Chunks embedded with configured embedding model and upserted to a named Pinecone namespace
- [ ] Progress bar shown in UI during upload/embedding (Server-Sent Events or polling)
- [ ] On completion, new knowledge base appears in the KB list and topic dropdown
- [ ] Depends on: "Multiple named knowledge bases" feature (#Phase1)

## Files likely affected
- `trainer/server.js` — `POST /api/kb/upload`
- `trainer/train.html` — upload UI
- `trainer/package.json` — add `pdf-parse` or `pdfjs-dist`

## Copilot hint
Create a `POST /api/kb/upload` route using `express` multipart (add `multer` package). Extract text with `pdf-parse`, chunk by character count with ~20% overlap, then reuse the embedding logic from `pinecone-upload.js`.
"@
},

@{
  title = "[feature] Knowledge base management UI — list, describe, delete indexes"
  labels = "enhancement,tier-2"
  body = @"
## Summary
Add a Knowledge Bases management screen that lists all available Pinecone indexes/namespaces with their chunk count and creation date, and allows the user to delete a knowledge base.

## Why (User Story)
As a **developer managing multiple study indexes**, I want a UI to see what knowledge bases exist, how many vectors each contains, and delete ones I no longer need, so that I can keep the Pinecone index clean and avoid paying for unused vectors.

## Acceptance Criteria
- [ ] `GET /api/kb/list` returns all configured knowledge bases with name, description, and vector count from Pinecone stats
- [ ] Management UI (accessible from settings panel) shows a table: Name | Vectors | Actions
- [ ] Delete button calls Pinecone `deleteAll` on the namespace and removes the entry from config
- [ ] Confirmation dialog required before delete
- [ ] Depends on: "Multiple named knowledge bases" feature

## Files likely affected
- `trainer/server.js` — `GET /api/kb/list`, `DELETE /api/kb/:name`
- `trainer/train.html` — KB management panel

## Copilot hint
Use `pc.index(indexName).describeIndexStats()` to get vector counts per namespace. Add a `DELETE /api/kb/:name` route that calls `pc.index(indexName).deleteAll({ namespace: name })`.
"@
},

@{
  title = "[feature] Custom table of contents — detect headings after upload, let user confirm topic structure"
  labels = "enhancement,tier-2"
  body = @"
## Summary
After a document is uploaded and chunked, display the detected headings as a hierarchy the user can review and edit. These confirmed headings become the entries in the topic dropdown for that knowledge base.

## Why (User Story)
As a **student uploading a new textbook**, I want to see the chapter and section structure detected from my document and confirm or rename it, so that the topic filter in the trainer reflects the actual structure of my material — not a generic flat list.

## Acceptance Criteria
- [ ] After upload, server returns detected heading hierarchy (H1/H2/H3 from the document)
- [ ] UI shows an editable tree view of headings with checkboxes to include/exclude
- [ ] Confirmed structure saved as `topic-config.json` for that knowledge base
- [ ] Topic dropdown populated from confirmed structure on next session load
- [ ] Depends on: File upload feature and Generic topic taxonomy feature

## Files likely affected
- `trainer/server.js` — heading extraction logic during chunking
- `trainer/train.html` — heading review UI step

## Copilot hint
During chunking in `POST /api/kb/upload`, collect all `<h1>`, `<h2>`, `<h3>` elements (or markdown `#` headers for TXT) and return them as a `headings` array alongside the upload success response. Build a tree from the nesting level.
"@
}
)

foreach ($issue in $issues_p2) {
  Write-Host "  Creating: $($issue.title.Substring(0, [Math]::Min(60, $issue.title.Length)))..."
  $tmpFile = [System.IO.Path]::GetTempFileName()
  $issue.body | Out-File -FilePath $tmpFile -Encoding utf8
  gh issue create `
    --repo $REPO `
    --title $issue.title `
    --label $issue.labels `
    --milestone "Phase 2 — Content Pipeline" `
    --body-file $tmpFile
  Remove-Item $tmpFile
}

Write-Host "`n=== STEP 6: Issues — Phase 3 Learning Intelligence ===" -ForegroundColor Cyan

$issues_p3 = @(

@{
  title = "[feature] Session persistence with SQLite — survive server restarts"
  labels = "enhancement,tier-3"
  body = @"
## Summary
Replace the in-memory `trainSessions` Map with a SQLite database so training history, scores, and progress survive server restarts and are available for analytics.

## Why (User Story)
As a **student in a multi-day study programme**, I want my training progress (questions answered, scores per topic, current level) to persist between sessions, so that I can continue where I left off after closing the browser or restarting the server — and review my historical performance.

## Acceptance Criteria
- [ ] Add `better-sqlite3` dependency
- [ ] Database stored at `trainer/data/sessions.db`
- [ ] Tables: `sessions`, `questions` (chunkId, question, answer, score, level, timestamp)
- [ ] `GET /api/train/history?sessionId=` returns past questions and scores for a session
- [ ] Session resume: if `sessionId` exists in DB, restore level and stats on `/api/train/question`
- [ ] In-memory Map remains as write-through cache; DB is source of truth on restart
- [ ] Foundation for: weak topic detection and spaced repetition

## Files likely affected
- `trainer/server.js` — session read/write
- `trainer/package.json` — add `better-sqlite3`
- `trainer/data/` — new directory (add to `.gitignore`)

## Copilot hint
Install `better-sqlite3`. Create a `db.js` module that opens/creates `sessions.db` and exports prepared statements for insert/select. Call `db.saveQuestion(...)` inside the evaluate endpoint after scoring, and `db.getSession(sid)` at the top of the question endpoint.
"@
},

@{
  title = "[feature] Weak topic detection — surface topics with lowest average scores"
  labels = "enhancement,tier-3"
  body = @"
## Summary
After each training session, analyse per-chunk scores from session history and surface the topics where the student scores lowest — displayed as a "Topics to Review" list.

## Why (User Story)
As a **student preparing for a certification exam**, I want the trainer to tell me which topics I consistently answer poorly, so that I can focus my remaining study time on actual weak areas instead of topics I already know well.

## Acceptance Criteria
- [ ] `GET /api/train/weakTopics?sessionId=` returns top 5 lowest-scoring chunk topics (min 2 answers per topic)
- [ ] Topics to Review panel shown in trainer UI after every 5th question
- [ ] Each entry shows: topic name, category, average score, number of attempts
- [ ] Clicking a topic sets the topic filter to that specific task/technique
- [ ] Depends on: Session persistence (SQLite) feature

## Files likely affected
- `trainer/server.js` — `GET /api/train/weakTopics`
- `trainer/train.html` — "Topics to Review" panel

## Copilot hint
Query the `questions` table: `SELECT chunkId, AVG(score) as avg, COUNT(*) as cnt FROM questions WHERE sessionId=? GROUP BY chunkId HAVING cnt >= 2 ORDER BY avg ASC LIMIT 5`. Join with the in-memory `chunkMap` to get topic labels and categories.
"@
},

@{
  title = "[feature] Generic UI labels — remove all BABOK-specific hardcoded text"
  labels = "enhancement,tier-3"
  body = @"
## Summary
All BABOK-specific strings in the UI ("BABOK® Training", "Knowledge Area Tasks", "Technique", "Perspective", etc.) should come from a configurable labels JSON so the trainer can be rebranded for any domain without editing HTML.

## Why (User Story)
As a **developer deploying this trainer for a non-BABOK domain** (e.g. PMP, AWS, Scrum), I want all domain-specific UI text to be driven by a config file, so that I can publish a correctly branded trainer for any subject by editing a single JSON file — with no HTML changes required.

## Acceptance Criteria
- [ ] Create `trainer/ui-labels.json` with all current BABOK-specific strings as defaults
- [ ] Server exposes `GET /api/ui-labels` returning the active label set
- [ ] `train.html` and `chat.html` load labels from `GET /api/ui-labels` on startup and apply them to all relevant text nodes
- [ ] UI labels editable in the settings panel
- [ ] Hardcoded strings "BABOK", "Knowledge Area", "Bloom's" etc. no longer appear in HTML source

## Files likely affected
- `trainer/train.html`, `trainer/chat.html`
- `trainer/server.js` — `GET /api/ui-labels`
- `trainer/ui-labels.json` — new file

## Copilot hint
Audit `train.html` for all literal strings. Extract them into `ui-labels.json`. Add a `GET /api/ui-labels` route. In the HTML, replace literals with `data-label="key"` attributes and a small JS function that walks `document.querySelectorAll('[data-label]')` and sets `textContent` from the fetched labels object.
"@
}
)

foreach ($issue in $issues_p3) {
  Write-Host "  Creating: $($issue.title.Substring(0, [Math]::Min(60, $issue.title.Length)))..."
  $tmpFile = [System.IO.Path]::GetTempFileName()
  $issue.body | Out-File -FilePath $tmpFile -Encoding utf8
  gh issue create `
    --repo $REPO `
    --title $issue.title `
    --label $issue.labels `
    --milestone "Phase 3 — Learning Intelligence" `
    --body-file $tmpFile
  Remove-Item $tmpFile
}

Write-Host "`n=== STEP 7: Issues — Phase 4 Multi-user & Strategic ===" -ForegroundColor Cyan

$issues_p4 = @(

@{
  title = "[feature] User accounts — per-user content and session isolation"
  labels = "enhancement,tier-4"
  body = @"
## Summary
Add username + password authentication with JWT tokens so multiple users can each have their own session history, scores, and Pinecone namespaces — isolated from each other.

## Why (User Story)
As a **trainer sharing this tool with a study group**, I want each learner to have their own login, so that their training progress, weak topic reports, and knowledge bases are private and independent — without one student's activity affecting another's.

## Acceptance Criteria
- [ ] `POST /api/auth/register` and `POST /api/auth/login` endpoints
- [ ] Passwords hashed with `bcrypt` (never stored in plain text)
- [ ] JWT issued on login; required on all `/api/train/*` and `/api/chat` routes
- [ ] Session and question history in SQLite scoped to `userId`
- [ ] Pinecone namespaces prefixed with `userId` to isolate knowledge bases
- [ ] Login/register UI on a separate page or modal
- [ ] Depends on: Session persistence (SQLite) feature

## Files likely affected
- `trainer/server.js` — auth routes, JWT middleware
- `trainer/package.json` — add `bcrypt`, `jsonwebtoken`
- `trainer/data/sessions.db` — add `users` table

## Copilot hint
Add a `users` table to SQLite with `id, username, passwordHash`. On login, verify with `bcrypt.compare`, sign a JWT with `jsonwebtoken`. Add an `authMiddleware` that verifies the JWT from `Authorization: Bearer` header and attaches `req.userId` for all protected routes.
"@
},

@{
  title = "[feature] Spaced repetition scheduling (SM-2 algorithm)"
  labels = "enhancement,tier-4"
  body = @"
## Summary
Replace random chunk selection with an SM-2 spaced repetition algorithm so chunks due for review are surfaced before new ones, and review intervals grow with demonstrated mastery.

## Why (User Story)
As a **student with limited daily study time**, I want the trainer to automatically schedule which topics to review and when — based on how well I answered them previously — so that I spend time reviewing material just before I am likely to forget it, maximising long-term retention with minimum effort.

## Acceptance Criteria
- [ ] Each chunk/user pair has an SM-2 record: `easeFactor`, `interval`, `repetitions`, `dueDate`
- [ ] On session start, chunks due today are prioritised over new/future chunks
- [ ] Score ≥ 7 increases interval; score < 4 resets to interval 1 (re-learn)
- [ ] `GET /api/train/due?sessionId=` returns count of chunks due today
- [ ] Depends on: Session persistence (SQLite) feature

## Files likely affected
- `trainer/server.js` — chunk selection logic in `POST /api/train/question`
- `trainer/data/sessions.db` — new `spaced_repetition` table

## Copilot hint
Add a `spaced_repetition` table: `userId, chunkId, easeFactor REAL, interval INTEGER, repetitions INTEGER, dueDate TEXT`. In the question endpoint, query for chunks where `dueDate <= date('now')` before falling back to random selection. After evaluation, update the SM-2 record using the standard formula.
"@
},

@{
  title = "[feature] URL/link ingestion — fetch and index web pages as knowledge base"
  labels = "enhancement,tier-4"
  body = @"
## Summary
Allow the user to paste a URL and have the server fetch, extract, chunk, and index the page content into a named knowledge base — extending the file upload pipeline to web content.

## Why (User Story)
As a **student studying from online documentation** (e.g. official framework docs, Wikipedia articles, blog posts), I want to paste a URL and have it automatically added to my knowledge base, so that I can train on any web content without downloading or converting files manually.

## Acceptance Criteria
- [ ] `POST /api/kb/ingest-url` accepts a URL and optional knowledge base name
- [ ] Server fetches URL with `node-fetch` or built-in `fetch`; extracts readable text with `@mozilla/readability` + `jsdom`
- [ ] Extracted text chunked and embedded using the same pipeline as file upload
- [ ] For JS-rendered pages: fallback to Playwright headless fetch (optional, noted as known limitation otherwise)
- [ ] Progress feedback returned via SSE or polling
- [ ] Depends on: File upload feature

## Files likely affected
- `trainer/server.js` — `POST /api/kb/ingest-url`
- `trainer/package.json` — add `@mozilla/readability`, `jsdom`

## Copilot hint
Use `fetch(url)` to get the HTML, parse with `new JSDOM(html)` and `new Readability(dom.window.document).parse()` to extract clean article text. Then pass the text through the same chunking and embedding pipeline used in `POST /api/kb/upload`.
"@
}
)

foreach ($issue in $issues_p4) {
  Write-Host "  Creating: $($issue.title.Substring(0, [Math]::Min(60, $issue.title.Length)))..."
  $tmpFile = [System.IO.Path]::GetTempFileName()
  $issue.body | Out-File -FilePath $tmpFile -Encoding utf8
  gh issue create `
    --repo $REPO `
    --title $issue.title `
    --label $issue.labels `
    --milestone "Phase 4 — Multi-user & Strategic" `
    --body-file $tmpFile
  Remove-Item $tmpFile
}

Write-Host "`n✅ All done! Check your issues at: https://github.com/$REPO/issues" -ForegroundColor Green
