---
paths:
  - "src-tauri/**/*.rs"
---

# Rust core rules

- Core logic lives in modules that don't depend on Tauri types; `src-tauri/src/commands/` only adapts. Unit-test the core.
- Errors: `thiserror` per module, mapped to `AppError { code, message, detail, retryable }` at the command boundary. No `unwrap()`/`expect()` outside tests and app startup.
- Async with tokio; never block the async runtime (use `spawn_blocking` for heavy parsing if needed); long work reports progress through a `Channel` and supports cancellation.
- Child processes only through `os/process.rs` (clippy `disallowed-methods` enforces it): argument arrays, stdin for large inputs, never a shell.
- git calls only through `git/runner.rs` with the standard `-c` options. Never run destructive commands on the user's checkout (reset --hard, clean, checkout of other refs, rebase, push --force).
- `tracing` for logs; redact tokens (`glpat-…`, `PRIVATE-TOKEN`) and never log file contents, prompts or Claude output (stderr, `result`): for Claude error codes log only `code` and message (NFR-08).
- Structs exposed to the UI derive `Serialize` + `ts_rs::TS` and are exported to `src/ipc/types/`.
- SQLite changes only through new migrations; never edit an applied migration.
- Integration tests are modules of one binary, `src-tauri/tests/it/main.rs` (E29): a new file goes into `tests/it/` with a `mod` line there and reaches the helpers through `use crate::fixture_repo;`. Its tests run in parallel with all the others in one process, so only a test that changes process-global state (the global logger, environment variables, the current directory) gets a binary of its own in `tests/`.
