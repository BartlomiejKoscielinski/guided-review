# Claude task contracts

Starting prompts and JSON Schemas for every Claude task the app runs (see `../05-integrations.md` › Tasks).

- `prompts/system-common.md` is appended to Claude Code's system prompt for every task (`--append-system-prompt-file`, rendered to a temp file).
- `prompts/<task>.md` is the user prompt template, sent through stdin. `{{name}}` placeholders are filled by `src-tauri/src/claude/prompts.rs`; `{{#each}}`-style loops are not supported, so the core renders lists into text before substitution.
- Large inputs (diffs, logs, thread lists) are written to files under `%APPDATA%\GuidedReview\tmp\<task-id>\` and the prompt references them by absolute path, so Claude reads them with the Read tool and the prompt stays small. That folder is outside Claude's working directory, so the runner passes `--add-dir <task folder>` (confirmed in S1). The folder is deleted when the task ends; it contains source code.
- `plan.md` serves every source: the core renders `{{source_label}}` and `{{source_block}}` for an MR (`!482 "Title" (feature/x → develop)`), a commit or range, or a local scope, and writes "none" into the description and threads inputs when there are none.
- Which per-task override (F-18.3) a task uses is listed in `05-integrations.md` › Tasks.
- `schemas/<task>.schema.json` is passed with `--json-schema`; Rust validates the result again and checks references (hunk IDs, step IDs, files, lines, evidence).
- Claude Code enforces `maxLength`, `pattern` and `minItems` by making the model try again (S1); to comply, the model shortens text or **invents items**. So: `maxItems`/`maxLength` freely (they only cap); `pattern`/`enum` only for formats (IDs, kebab-case kinds, SHAs); `minItems` only where a value always exists: plan steps and their hunk IDs, skim hunk IDs, a finding's evidence (the finding's own line counts) and MR test steps (a "no manual test needed" step is allowed). The prompts say so, and Rust rejects evidence that points at a missing file or line.
- Every change to a prompt or schema bumps `PROMPT_VERSION` in `claude/prompts.rs` (part of the cache key).
- Team rules come from `.review/rules.md` **on the target branch** (`git show <base_sha>:.review/rules.md`), never from the MR head, so an MR cannot change the rules it is reviewed with.
