# Cyber Definition Timeout Progression

## Problem

In cyber dictation with definitions enabled, leaving a round untouched until the countdown expired submitted only the word field. The UI then moved to the definition input and waited forever for manual submission instead of completing the round.

## Root Cause

The timeout handler built its update from the round snapshot before applying the word answer. It only submitted `answerDef` when that old snapshot already contained `answer`, so an untouched round could never submit both fields in the same timeout event.

## Fix

- Extracted timeout submission into the pure production helper `timedOutInputPatch`.
- Each incomplete field is now handled independently. In definition mode, timeout commits both current values at once; untouched values become empty strings and therefore count as completed input.
- The existing audio/countdown coordination remains unchanged: after timeout submission, the round advances immediately if audio is no longer sounding, or after the current spoken segment finishes.
- Added the rule to `AGENTS.md` to prevent future regressions.

## Verification

- Pure unit tests cover untouched definition rounds, partially entered definitions after a submitted word, and non-definition cyber rounds.
- The production `useDictation` orchestration test reproduces a fully untouched definition round, finishes the audio track, expires the real fake-timer countdown, and verifies transition to results with `{ answer: "", answerDef: "" }`.
- `pnpm test:run`: 27 files, 204 tests passed.
