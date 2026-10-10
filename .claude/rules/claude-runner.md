---
paths:
  - "src-tauri/src/claude/**"
  - "src-tauri/resources/prompts/**"
  - "src-tauri/resources/schemas/**"
---

# Claude runner rules (security-critical)

- `runner.rs` is the only place that builds `claude` command lines. Profiles: read-only and fix-own-code, exactly as in `docs/05-integrations.md`. A snapshot test asserts the argv of each profile.
- Read-only profile on every task that runs in a teammate's worktree. Fix profile only when the session source is local changes or the user's own MR, with `Edit(<that one file>)` and the post-run guard that restores any other change.
- Never `--bare`, `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, Bash or WebFetch tools.
- Prompts go through stdin; large inputs as files in the task's temp folder referenced by path.
- Every structured result is validated again in Rust (IDs, files, lines inside the step) before use; invalid results become `CLAUDE_SCHEMA` errors, never partial data.
- Changing a prompt or schema bumps `PROMPT_VERSION`.
- Team rules are read from the target branch (`git show <base>:.review/rules.md`), never from the MR head.
