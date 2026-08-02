## Summary
`trainer-config.json` uses old Bloom's Taxonomy names (Knowledge, Comprehension, Application, Analysis, Synthesis, Evaluation) for levels 1–6. `server.js` uses custom names (Recognition, Multi-Select, Understanding, Application, Analysis, Synthesis). The config overrides the server defaults at startup, so the UI shows wrong level names.

## Why (User Story)
As a **student using the trainer**, I want the level names in the UI to match the README and the actual question format, so that I understand what type of question to expect at each level and can align my preparation accordingly.

## Acceptance Criteria
- [ ] `trainer-config.json` level names updated to match `server.js`: Level 1=Recognition, 2=Multi-Select, 3=Understanding, 4=Application, 5=Analysis, 6=Synthesis
- [ ] Or: level name overrides removed from `trainer-config.json` entirely so server defaults always win
- [ ] Level badges and descriptions in the UI match the README table

## Files likely affected
- `trainer/trainer-config.json`

## Copilot hint
In `trainer-config.json`, update the `levels` block names to: 1="Recognition", 2="Multi-Select", 3="Understanding", 4="Application", 5="Analysis", 6="Synthesis". Alternatively delete all `name` fields inside the `levels` block to let `server.js` defaults take effect.
