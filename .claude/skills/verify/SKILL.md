---
name: verify
description: Run all checks for Guided Review (types, lint, unit tests, Rust fmt/clippy/tests, and e2e when UI changed) and fix failures. Use before declaring any task done.
---

1. Run `npm run verify`. If UI code changed in this session, also run `npm run e2e`.
2. For each failure: find the cause and fix it in the code. Do not delete or skip tests, do not weaken lint rules, do not add `#[allow(...)]` or `// @ts-ignore` to silence real problems. If a test is wrong because the spec changed, update the test and say so.
3. Re-run until everything passes.
4. Report what failed and how you fixed it, in a short list.
