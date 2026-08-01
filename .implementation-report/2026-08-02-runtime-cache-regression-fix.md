# Runtime cache regression fix

## Symptoms

- Web development mode could receive a successful TTS preparation response but then get `404` from `/api/audio`; the named MP3 was absent from `.mds-data/word-cache`.
- The packaged Windows client could play audio, but enabling definitions could report `AI 未返回 JSON 格式的释义` while Web mode appeared normal.

## Findings

- A fresh development-server probe proved that the dynamic audio route and the Web cache directory can write and read MP3 files normally.
- The TTS route nevertheless had an invariant gap: when a request was aborted after synthesis, the synthesis function could return without committing the file, while the outer route still returned `200` with its filename.
- Web mode already had a populated `definitions.json`, so it usually skipped the remote AI call. The new client cache had no definitions file and exposed the response parser's narrow assumptions. This was not a failure to read a packaged JSON file; definitions are intentionally generated remotely and cached externally.

## Changes

- TTS aborts now fail explicitly with status `499` instead of returning a nonexistent filename.
- Every non-cached TTS item is verified through the runtime cache abstraction before a successful response is returned; an uncommitted write becomes a server error.
- Definition response parsing now accepts plain JSON, Markdown JSON fences, explanatory/reasoning text containing a balanced final JSON object, content-part arrays, tool-call arguments, array form, and object-map form.
- Unparseable or entirely invalid definition output returns the existing valid definitions plus a missing list and warning. It does not block preparation and does not write a negative cache, so the missing words are retried next time.

## Verification

- Focused route/client API tests: 21 passed.
- Full Vitest suite: 15 files, 167 tests passed.
- Production Web build completed.
- A real Vite development server generated a unique uncached word, returned `200` from `/api/tts`, and immediately served the resulting 40,032-byte MP3 with `200` from `/api/audio`.
- The packaged client-mode server parsed a mocked content-parts AI response and wrote the resulting `definitions.json` to an external temporary cache directory.
- The formal `pnpm client:package` pipeline passed and verified `dist/electron/mds-0.1.0-x64.exe` as a 91,344,836-byte Windows MZ portable executable with no bundled runtime cache.

## Follow-up

- Retest definitions with the newly generated portable executable; an older copy still contains the old server parser.

## Subsequent finding

The TTS success/write invariant fixed a real abort race, but it was not the complete cause of the persistent Web-dev `verify` report. A later browser-level reproduction showed that the file was written successfully and then removed by the intentional playback-failure cleanup after Nitro/Vite returned `404` specifically for `Sec-Fetch-Dest: audio`. The separate development-routing fix is documented in `2026-08-02-web-dev-audio-routing-fix.md`.
