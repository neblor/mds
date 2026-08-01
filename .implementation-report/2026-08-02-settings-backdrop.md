# Settings backdrop close

## Change

- Clicking the settings overlay outside the panel now closes settings.
- The handler requires `event.target === event.currentTarget`, so clicks on inputs, controls, or any panel content do not close it accidentally.

## Save behavior

- Text inputs use `onInput` and call the settings update for every edit.
- The update synchronously changes the Solid state, while `es-toolkit` debounces the `localStorage` write for 1.5 seconds after the last change.
- Select, multiplier buttons, and the countdown switch share the same debounced persistence path.
- Closing the settings panel (including backdrop, close button, or Escape) flushes a pending write immediately; page exit and component cleanup do the same.
- There is no blur-save handler, draft state, or confirmation button.

## Verification

- Added tests for direct backdrop clicks and panel-descendant clicks.
- Added orchestration coverage for the 1.5-second debounce and close-time flush.
- Full Vitest suite passed: 18 files / 175 tests.
- Web production build and smoke test passed.
- Electron portable package was rebuilt and verified at `dist/electron/mds-0.1.0-x64.exe` (91,346,818 bytes).
