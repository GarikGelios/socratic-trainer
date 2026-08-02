## Summary
The root `package.json` defines `scripts.start` as `node trainer/server.js` but has no `dependencies` and no `node_modules`. Running `npm start` from the project root fails because `express`, `openai`, etc. are only installed in `trainer/node_modules`.

## Why (User Story)
As a **developer cloning this repository for the first time**, I want `npm install && npm start` to work from the project root, so that I can get the server running in two commands without reading internal module structure or navigating to subdirectories.

## Acceptance Criteria
- [ ] Either: root `package.json` converted to an npm workspace (`"workspaces": ["chunker","trainer"]`) so `npm install` at root installs all deps
- [ ] Or: README Quick Start clearly states `cd trainer && npm install && npm start` as the correct commands
- [ ] Clean `npm install` from the correct location succeeds and `npm start` launches the server

## Files likely affected
- `package.json` (root)
- `README.md`

## Copilot hint
Add `"private": true` and `"workspaces": ["chunker", "trainer"]` to the root `package.json`. Then delete `trainer/node_modules` and `chunker/node_modules`, run `npm install` from root, and verify both submodule deps resolve correctly.
