# Batch Import, Word Persistence, and Client Versioning

## Request

- Add a bulk-import entry beside the regular word input.
- Accept whitespace—including spaces, tabs, and line breaks—plus English commas and semicolons as separators.
- Persist the word list in browser storage.
- Require an explicit package bump mode and keep agent test packages separate from release artifacts.

## Implementation

- Added a batch-import dialog using the same dimmed, blurred backdrop as settings. It auto-focuses the textarea, closes with Escape or a backdrop click, and imports with the button or `Ctrl/Cmd + Enter`.
- Parsing is isolated in `batch-import.ts`. It removes empty entries and duplicates both within the incoming text and against the current word list.
- Added `word-storage.ts` as the localStorage boundary. All word-list mutations persist immediately, and saved words are restored during client mounting.
- Added `client-package-version.ts` for strict bump parsing and deterministic SemVer updates.
- Replaced the direct package command with `scripts/package-client.mjs`. It requires exactly one of `major`, `minor`, `patch`, or `test`, runs the full check and package verification, and restores `package.json` if packaging fails.
- Release modes write to `dist/electron` and persist the bumped version only after success. Test mode keeps the version unchanged and writes to `dist/electron-test`.
- After package verification, the production cleanup module deletes every output entry except the newly verified portable EXE. This removes `win-unpacked`, builder diagnostics, and older artifacts without weakening the pre-cleanup content verification.

## Verification

- Unit coverage includes mixed whitespace/comma/semicolon parsing, duplicate handling, invalid localStorage content, persistence across word mutations, all four version modes, reset semantics, and invalid package arguments.
- Package-cleanup tests execute the production filesystem implementation against a temporary output tree, covering recursive temporary-file removal, old EXE removal, final-artifact preservation, missing-artifact refusal, and path traversal refusal.
- `pnpm test:run`: 26 files, 200 tests passed after adding package cleanup coverage.
- `pnpm web:build`: passed.
- Lightweight browser inspection confirmed the modal focus, mixed-separator import, keyboard submit, and post-refresh restoration. Per project policy, flow correctness remains centered on extracted unit-tested logic rather than expanding brittle E2E automation.
- `pnpm client:package test`: passed at the current `0.2.0` version. It reran all 200 unit tests, the production build, HTTP smoke test, portable packaging, and package-content verification. Cleanup removed `builder-debug.yml`, the previous `0.1.0` EXE, and `win-unpacked`; `dist/electron-test` now contains only `mds-0.2.0-x64.exe` (91,350,864 bytes). `package.json` remained at `0.2.0` with the release output directory restored.

## Documentation

- Updated the paired Pencil design and design notes for the new input-row action and modal.
- Updated `AGENTS.md` with separator, persistence, version-source, mandatory bump, rollback, output-directory, and agent permission rules.
- Updated the bilingual README with bulk import, persistence, and release/test packaging guidance.
