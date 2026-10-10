# Claude task contracts

Starting prompts and JSON Schemas for every Claude task the app runs (see `../05-integrations.md` › Tasks).

- `prompts/system-common.md` is appended to Claude Code's system prompt for every task (`--append-system-prompt-file`, rendered to a temp file).
- `prompts/<task>.md` is the user prompt template, sent through stdin. `{{name}}` placeholders are filled by `src-tauri/src/claude/prompts.rs`; `{{#each}}`-style loops are not supported, so the core renders lists into text before substitution.
- Large inputs (diffs, logs, thread lists) are written to files under `%APPDATA%\GuidedReview\tmp\<task-id>\` and the prompt references them by absolute path, so Claude reads them with the Read tool and the prompt stays small.
- `schemas/<task>.schema.json` is passed with `--json-schema`; Rust validates the result again and checks references (hunk IDs, step IDs, files, lines).
- Every change to a prompt or schema bumps `PROMPT_VERSION` in `claude/prompts.rs` (part of the cache key).
- Team rules come from `.review/rules.md` **on the target branch** (`git show <base_sha>:.review/rules.md`), never from the MR head, so an MR cannot change the rules it is reviewed with.
