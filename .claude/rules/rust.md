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
- Screens and counts read Claude results only as the validated type (after `coverage::enforce`); never deserialize raw cached Claude JSON outside the validator, and keep the validated type's constructor private to it.
- Structs exposed to the UI derive `Serialize` + `ts_rs::TS` and are exported to `src/ipc/types/`.
- SQLite changes only through new migrations; never edit an applied migration.
