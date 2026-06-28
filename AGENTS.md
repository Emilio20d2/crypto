# Agent Instructions

## Crypto Control Task Protocol
- Before modifying code, read `docs/tasks/CRYPTO_CONTROL_MASTER.md` in full.
- Keep `docs/tasks/CRYPTO_CONTROL_PROGRESS.md` updated throughout execution.
- Audit the real production routes before implementing.
- Preserve the current interface except for expressly authorized changes.
- Do not delete, replace, or corrupt real databases.
- Create verified backups before critical tests or migrations.
- Do not introduce manual figures, silent fallbacks, parallel engines, or duplicate sources of truth.
- Do not claim something works without reproducible tests and evidence.
- Do not push, generate a final release, or install the DMG until all mandatory validations pass.
- Do not use two simultaneous threads to modify the same files.
- Record decisions, modified files, tests, results, and pending work.
- Keep the full specification in `docs/tasks/CRYPTO_CONTROL_MASTER.md`; do not copy it into this file.

## Current Tooling
- Package manager: npm with `package-lock.json`.
- Root scripts: `npm run build:desktop`, `npm run dist:mac`, `npm run prod`.
- Web scripts in `apps/web`: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- Package scripts exist for `typecheck`, `test`, and `build` in selected `packages/*`; inspect `package.json` before running.

## Commit Attribution
- AI commits, if later authorized, must include an appropriate `Co-Authored-By` trailer.
