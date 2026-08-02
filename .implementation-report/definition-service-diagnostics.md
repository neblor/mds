# Definition Service Extraction and Diagnostics

## Request

- Extract the AI definition request from the API route into independently testable business modules.
- Exercise the complete definition and cache path with 20 words.
- Add `pnpm get:explain word1 word2 ...` for direct manual provider testing.
- Diagnose why a larger word list sometimes produced no cached definitions.
- Log third-party failures and compatibility fallbacks under Client `mds-data/logs`.

## Implementation

- `definition-provider.ts` owns OpenAI-compatible requests, progressive compatibility fallback, response parsing, requested-word alignment, completion diagnostics, and output completeness warnings.
- `definition-service.ts` owns cache hits, provider orchestration, validated merging, atomic cache writes, and read-after-write verification.
- `/api/definitions` is now a thin HTTP validation/adapter route.
- The response format changed from a verbose array to a compact word-to-definition object, and the request now asks for up to 4096 output tokens.
- Multiple JSON/content parts are merged instead of returning the first non-empty partial candidate.
- Case-only key drift from a provider is reconciled when the requested key is unambiguous.
- Compatibility fallback now removes `response_format` first while retaining `reasoning_effort: none`; only a second 400/422 removes reasoning configuration.
- Client diagnostic JSONL logs are written to `mds-data/logs/ai-definitions.log`, rotated at 1 MiB, with endpoint credentials/query strings and key fields redacted.
- Added `.env.example` and `scripts/get-explain.mjs`. The script calls the provider directly and deliberately bypasses the application cache, making provider behavior easy to compare with the integrated path.

## Verification

- 20-word provider unit test: all definitions parsed and aligned in one response.
- 20-word service unit test: all definitions merged and cache read-after-write verified.
- 20-word route test: all definitions written to the actual filesystem cache implementation.
- Failure tests cover partial/truncated responses, multi-part response merging, compatibility fallback, cache write errors, log redaction, and log rotation.
- `pnpm test:run`: 22 files, 187 tests passed.
- `pnpm web:build`: passed.
- `pnpm web:smoke`: HTTP 200 passed.
- `pnpm get:explain --help`: passed. A real provider call was not run because the project has no `.env` with CLI credentials.

## Diagnosis

The evidence does not support a cache-size threshold:

- The existing Web `definitions.json` already contains 12 entries and is only 946 bytes.
- The real filesystem cache test writes and rereads 20 entries successfully.
- The cache implementation serializes the full object and atomically renames it; word count does not alter the write path.

The more likely failure was upstream response/handling instability whose evidence was discarded:

- The old request had no explicit output budget; larger word lists produce longer JSON and increase the chance of incomplete output.
- `finish_reason` and token usage were ignored, so output truncation could not be identified.
- The old parser returned the first non-empty JSON candidate rather than merging all content parts.
- Only exact provider keys were accepted, so case-only changes were silently discarded.
- On compatibility fallback, both structured output and thinking-disable parameters were removed together.
- Invalid/empty/partial results were intentionally returned as HTTP 200 so preparation could continue, while the client consumed only `definitions` and discarded `missing`/`warning`; this explains the silent transition into dictation.
- Cache write exceptions were swallowed and never verified, so a real disk failure was also indistinguishable from an empty provider response.

After this change, provider truncation/partial output and actual cache write failure are separately observable in diagnostics and Client logs. Missing definitions are still not negatively cached, so later preparations retry them.

## Follow-up

If user-visible non-blocking warnings are desired on the ready screen, add a dedicated preparation warning state. This was not added here because partial definitions are explicitly allowed to continue and the current request focused on extraction, testing, CLI diagnostics, and Client logging.

## Documentation

- Added the provider/service separation, 20-word regression boundary, reusable pnpm diagnostics, secret-safe logging, and Client log requirements to `AGENTS.md`.
- Replaced the generated SolidStart README with a concise bilingual Chinese/English project guide covering features, setup, usage, AI diagnostics, Windows packaging, runtime data, commands, stack, and the MIT license.
