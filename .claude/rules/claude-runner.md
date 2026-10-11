---
paths:
  - "src-tauri/src/claude/**"
  - "src-tauri/resources/prompts/**"
  - "src-tauri/resources/schemas/**"
---

# Claude runner rules (security-critical)

- `runner.rs` is the only place that builds `claude` command lines. Profiles: read-only and fix-own-code, exactly as in `docs/05-integrations.md`. A snapshot test asserts the argv of each profile.
- Read-only profile on every task that runs in a teammate's worktree. Fix profile only when the session source is local changes or the user's own MR, in an app-managed scratch worktree (ADR-018), with `Edit(<that one file>)` and the post-run guard; the user's working copy is written only on Accept, and only if the file is unchanged since the run started.
- The `claude` executable is resolved per ADR-021 (native `claude.exe` first, never `claude.cmd` through `cmd.exe`); minimum Claude Code 2.1.248.
- Both profiles pass `--restricted` (ADR-022), never `--setting-sources user` alone: that loads the user's hooks, plugins and memory into every task (S3).
- The Fix allow rule is `Edit(/<path relative to the scratch worktree>)`: forward slashes, gitignore special characters escaped, never a bare file name (S4).
- A `permission_denials` entry for a Read under the task folder fails the task (`CLAUDE_FAILED`); errors are mapped from `is_error`, `api_error_status` and `terminal_reason`, never from `subtype` (05 › Errors from Claude).
- When the app runs inside a Claude Code session (`CLAUDECODE` set), the child environment drops that session's variables (05 › Environment).
- Only synthetic fixture repos on the development PC (ADR-019); never run `claude` there on company code.
- Never `--bare`, `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, Bash or WebFetch tools.
- Prompts go through stdin; large inputs as files in the task's temp folder referenced by path.
- Every structured result is validated again in Rust (IDs, files, lines inside the step) before use; invalid results become `CLAUDE_SCHEMA` errors, never partial data.
- Changing a prompt or schema bumps `PROMPT_VERSION`.
- Team rules are read from the target branch (`git show <base>:.review/rules.md`), never from the MR head.
