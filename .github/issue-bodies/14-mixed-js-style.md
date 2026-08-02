## Summary
The `loadExternalConfig` IIFE in `server.js` uses `var` declarations and `function` keyword callbacks while the rest of the file consistently uses `const`/`let` and arrow functions. This creates unnecessary cognitive friction when reading the file.

## Why (User Story)
As a **developer maintaining server.js**, I want a consistent modern JavaScript style throughout the entire file, so that I can read and modify any section without switching mental models between ES5 and ES2015+ syntax patterns.

## Acceptance Criteria
- [ ] All `var` declarations in `loadExternalConfig` replaced with `const` or `let`
- [ ] `function` keyword callbacks replaced with arrow functions where semantically equivalent
- [ ] No behaviour change — syntax modernisation only
- [ ] No remaining `var` keyword anywhere in `server.js`

## Files likely affected
- `trainer/server.js` — `loadExternalConfig` IIFE (approximately line 260)

## Copilot hint
Search `server.js` for `var `. All occurrences are inside the `loadExternalConfig` IIFE. Replace `var ext` with `const ext`, `var cfgPath` with `const cfgPath`, etc. Replace `forEach(function(k)` callbacks with `forEach((k) =>`.
