# Results Escape Close

## Change

- Escape on the results screen now explicitly prevents the browser default and executes the same `closeResults` path as the Close button.
- This returns to the preserved word list and also aborts any pronunciation preview currently playing.
- The behavior is recorded in `AGENTS.md`.

## Verification

- The production orchestration test reaches the results screen, starts a pronunciation preview, dispatches Escape from a focused result button, and verifies `preventDefault`, preview abortion, audio-state cleanup, and transition back to `idle`.
