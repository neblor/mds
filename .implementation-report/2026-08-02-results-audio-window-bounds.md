# Results audio and window bounds

## Requirements

- Add a Lucide audio icon beside every result word so the user can replay that word's pronunciation.
- Keep the Electron window adjustable for smaller screens, but constrain it between roughly two-thirds of the default size and the current default size. Disable maximize and fullscreen.

## Implementation

- Result rows now retain the prepared `audioName` alongside the word and answer data.
- The result view renders a `Volume2` button immediately beside each word. It has an accessible label, keyboard focus style, disabled state for a missing cache name, and a pulse state while playing.
- Preview playback reuses `playWithIntervals` and `/api/audio`, plays exactly once, stops the previous preview before starting another, stops when results close, and invalidates the cache if media playback fails.
- The result-page global Enter shortcut ignores focused interactive controls, so pressing Enter on the audio button plays it instead of closing the result page.
- Electron window sizing is centralized in `electron/window-options.mjs`: default/maximum `1120×820`, minimum `747×547`, resizable within that range, `maximizable: false`, and `fullscreenable: false`.
- The main process also calls `setMaximizable(false)` and `setFullScreenable(false)` after creating the window for platform-level enforcement.

## Verification

- Added orchestration coverage for result audio metadata, one-shot playback, playing state, cache invalidation, keyboard behavior, and cleanup on close.
- Added pure configuration tests for Electron window size limits and fullscreen/maximize settings.
- `pnpm check` passed: 16 Vitest files / 170 tests, production Web build, and production Web smoke test.
- `pnpm client:package` completed and verified the updated 91,345,565-byte Windows portable executable, including the new window configuration module.
