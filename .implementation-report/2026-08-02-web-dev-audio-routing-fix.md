# Web development audio routing fix

## Symptom

In Web development mode, `/api/tts` returned `200` for `verify_en-us-avaneural_e4ce29.mp3`, but the browser received `404` from `/api/audio` and the file was absent when inspected afterward. Electron client playback remained correct.

## Root cause

The MP3 was successfully written first. Nitro 3 beta's Vite development middleware classifies requests with `Sec-Fetch-Dest: audio` as static assets and skips Nitro when it does not recognize `/api/audio` as an explicit route at that stage. Vite then returned `Cannot GET /api/audio`.

The existing playback-failure protection correctly called `/api/cache-invalidate` after that 404 and removed the just-written file. This cleanup was expected behavior, but the final disk state misleadingly resembled a failed write.

Evidence from the same running development server before the fix:

- Immediately after preparation: MP3 existed, 7,488 bytes.
- Normal HTTP GET: `200`, 7,488 bytes.
- GET with browser media headers: `404 Cannot GET /api/audio`.
- Browser sequence: TTS `200` → audio `404` → cache-invalidate `200` → file removed.

## Fix

- Added a Vite `configureServer` pre-middleware in `scripts/vite-api-media-route.mjs`.
- Only `/api/audio` requests whose destination is `audio` are normalized to destination `empty`, causing Nitro's development middleware to execute the dynamic API route.
- Static media and ordinary API fetches are unchanged.
- Playback-failure cache invalidation remains unchanged.

## Client isolation

The workaround exists only in Vite's development-server hook:

- `vite build` does not execute `configureServer`.
- Production Nitro and the Electron embedded server keep their existing routing.
- The Vite compatibility script is outside Electron's configured package files and is not included in `win-unpacked`.
- Electron directory packaging completed successfully after the change.

## Verification

- Unit tests cover the narrow request-header normalization and non-target requests.
- Real Chromium Web-dev flow: TTS `200`, audio `200`, MP3 remained at 7,488 bytes, and no invalidation request occurred.
- `pnpm check`: 17 Vitest files / 172 tests passed, production build passed, production smoke passed.
- Production smoke now explicitly requests a seeded external-cache MP3 with `Sec-Fetch-Dest: audio` and verifies the exact response bytes, guarding the route shared by Electron.
- `pnpm client:package:dir` completed successfully.
