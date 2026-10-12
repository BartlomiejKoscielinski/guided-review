---
name: verify
description: Run all checks for Guided Review (types, lint, unit tests, Rust fmt/clippy/tests, and e2e when UI changed) and fix failures. Use before declaring any task done.
---

Keep the output small: never run `npm run verify` or `npm run e2e` raw (cargo and Playwright print thousands of lines). Use the quiet runner, which prints one line per step and the error lines of failing steps; the full output stays in `.verify/<step>.log`.

1. Run `node tools/verify.mjs`. If UI code changed in this session, run `node tools/verify.mjs --e2e` instead.
2. For each FAIL: the printed lines are usually enough. If not, `grep`/`tail` the log (`grep -n -A5 "error\[" .verify/rust_clippy.log`); do not read whole logs. Find the cause and fix it in the code. Do not delete or skip tests, do not weaken lint rules, do not add `#[allow(...)]` or `// @ts-ignore` to silence real problems, do not add retries to hide flakiness. If a test is wrong because the spec changed, update the test and say so.
3. Re-run only what failed: `node tools/verify.mjs --only rust:clippy,test` or `node tools/verify.mjs --only e2e changes` (one spec). When everything passes, do one final full run (with `--e2e` if UI changed).
4. Report what failed and how you fixed it, in a short list.

Steps: `typecheck`, `lint`, `format:check`, `test`, `test:tools`, `rust:fmt`, `rust:clippy`, `rust:test`, `e2e`. `format:check` failures: run `npx prettier --write <files>`; `rust:fmt`: `cargo fmt --manifest-path src-tauri/Cargo.toml --all`.
