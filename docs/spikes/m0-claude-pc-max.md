# M0 spikes S1–S4 · Claude Code on the development PC (PC/Max)

Detailed notes behind the S1–S4 rows of the spike table in `08-decisions.md`. Field visit 1 repeats them on Claude Enterprise.

- **Where:** development PC, Windows 11 Pro 10.0.26200, personal Claude Max account (`authMethod: "claude.ai"`, `subscriptionType: "max"`).
- **Claude Code:** 2.1.296, native installer (`%USERPROFILE%\.local\bin\claude.exe`; no npm install, so the `claude.cmd`/`cli.js` path of ADR-021 was not exercised).
- **Date:** 2026-10-11. **Model:** Haiku 5.5 (`claude-haiku-5-5`, effort `low`) unless the model was the point.
- **Harness:** `tools/spikes/claude/` (`s1.mjs`, `s3.mjs`, `s4.mjs`). `claude.exe` is spawned with an argument array (no shell, hidden window), the prompt goes through stdin, and the environment is stripped of a surrounding Claude Code session's variables (`CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_BASE_URL`, `MCP_*`), as when `GuidedReview.exe` starts from Explorer. Fixtures are synthetic repos under `%TEMP%\gr spikes zażółć\` (spaces and Polish characters on purpose). Raw outputs stay in `…\out\` (not committed).
- **Budget:** 27 calls that produced an answer (incl. the Rust spawn check and one login probe) and 7 that failed before generation (bad flag, bad schema, not signed in, 2 × expired login, unknown model, Fable credits); client-side cost estimate $0.18.

## S1 · Read-only profile with subscription login

Profile as in `05` › Invocation profiles (`-p --output-format json --json-schema … --model … --effort low --tools "Read,Grep,Glob" --permission-mode dontAsk --setting-sources user --strict-mcp-config --disallowedTools "mcp__*" --append-system-prompt-file <tmp>\system-common.md --add-dir <tmp> --no-session-persistence`), cwd = fixture repo, prompt via stdin.

| Check | Result |
| - | - |
| Works with subscription login | Yes. `structured_output` matches the schema; input canary (file outside cwd), system canary (from the appended file) and a value from a repo file all correct. 4–10 s per call on Haiku. |
| JSON result fields | `type`, `subtype`, `is_error`, `result`, `structured_output`, `session_id`, `num_turns`, `duration_ms`, `duration_api_ms`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `terminal_reason`, `api_error_status`, `stop_reason`, `uuid`, timing fields (`ttft_ms`, …), `subagent_stats`, `fast_mode_state`. **`subtype` stays `"success"` even when `is_error` is true**; use `is_error`, `terminal_reason` and `api_error_status`. |
| Exit codes | 0 on success. 1 for every failure: unknown flag (stderr `error: unknown option '…'`, no JSON); invalid schema (stderr `Error: --json-schema is not a valid JSON Schema: …`, no JSON); not signed in (JSON, `result: "Not logged in · Please run /login"`, `terminal_reason: "api_error"`); expired OAuth session (JSON, `result: "Failed to authenticate: OAuth session expired and could not be refreshed"`); unknown model (JSON, `api_error_status: 404`, stderr `[claude-code:unrecognized_model]`); `--max-turns` reached (`subtype: "error_max_turns"`, `terminal_reason: "max_turns"`); usage limit (`api_error_status: 429`). A killed process (TerminateProcess) writes no result. |
| `claude auth status` | JSON keys `loggedIn`, `authMethod`, `apiProvider`, `analyticsDisabled`, `projectsDirectory`, `configDirectory`, `email`, `orgId`, `orgName`, `subscriptionType`; exit 1 and `authMethod: "none"` when not signed in (tested with `CLAUDE_CONFIG_DIR` pointing to an empty folder). **It reported `loggedIn: true` while the stored OAuth session had expired and could not be refreshed**; only a real call (the startup probe) showed the failure. |
| stream-json + `--json-schema` | Works; the last line is the `result` event with `structured_output`. Event types seen: `system/hook_started`, `system/hook_response`, `system/init`, `system/status`, `stream_event`, `system/thinking_tokens`, `assistant`, `user`, `rate_limit_event`, `system/notification`, `result`. |
| `--resume <session_id>` | Works with stream-json and a schema; same `session_id`, the follow-up sees the first turn. Needs session persistence (no `--no-session-persistence`). |
| Schema keywords (`maxLength`, `pattern`, `minItems`) | **Enforced.** The CLI rejected non-conforming output and the model retried (`num_turns: 4`): asked for a long lower-case word and one item, it returned `"HELLO"` and padded the array with invented items to reach `minItems: 3`. Rust validation stays authoritative; schemas should avoid constraints that can only be met by inventing data. |
| `--append-system-prompt-file` | Exists and works (documented in the CLI reference; not listed by `--help`). |
| Read outside cwd under `dontAsk` | Without `--add-dir`: denied, the run still ends with `is_error: false` and the denial appears only in `permission_denials` (R-04). With `--add-dir <tmp>`: allowed. |
| `--tools ""` | `init.tools` is empty; the startup probe answers `OK`. |
| `--disallowedTools "mcp__*"` | Accepted; no MCP tools in any run (docs: a bare pattern removes the matching tools). |
| Models and efforts | `claude-opus-5-5 --effort max`, `claude-sonnet-5-5 --effort xhigh`, `claude-haiku-5-5 --effort max` succeed (`init.model` = the ID). Docs (model-config): Opus/Sonnet/Haiku 5.5 and Fable 5.1 support `low`…`max`; an unsupported level silently falls back to the highest supported one below it. `claude-fable-5-1` on Max fails with `api_error_status: 429`: "Fable 5.1 requires usage credits…". |
| Usage-limit signal (F-18.7) | Result: `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: 429`. stream-json: `rate_limit_event` with `rate_limit_info.status: "rejected"`, `errorCode` (`credits_required`), `resetsAt`. Allowed calls carry `rate_limit_event` with `status: "allowed"` and per-window `utilization`. A plain 5-hour-window exhaustion was not provoked. |
| Spawn from Rust (R-03) | `std::process::Command` with `CREATE_NO_WINDOW`, args `--tools ""` and a `--json-schema` containing `\"`, `&`, `<>`, spaces and `zażółć gęślą`: the schema arrived intact (a mangled argument would be invalid JSON) and the Polish text came back unchanged. |
| Environment | This PC's Claude Code desktop session sets ~35 variables (`CLAUDECODE`, `CLAUDE_CODE_*`, `ANTHROPIC_BASE_URL`, …). A `GuidedReview.exe` started from such a session (e.g. `npm run tauri dev` inside Claude Code) passes them to `claude`; the spike removed them. |

## S3 · What is loaded in a teammate's worktree

Fixture "teammate repo" with canaries: `CLAUDE.md` (PINEAPPLE), `AGENTS.md` (MANGO), `CLAUDE.local.md` (GUAVA), `.claude/rules/canary.md` (PAPAYA), project skill `.claude/skills/canary-skill` (FIG), `.claude/settings.json` hooks SessionStart / UserPromptSubmit (injects LYCHEE) / PreToolUse that append to a marker file, `.mcp.json` server that writes a marker on start. User-level config on this PC: `~/.claude/settings.json` hooks (UserPromptSubmit, PreToolUse ×2, PostToolUse ×2, Stop) and plugins `everything-claude-code` and `caveman` (SessionStart), `~/.claude/CLAUDE.md` and `~/.claude/rules/`. Detection: the model's answer (without tools) about codewords and two phrases from the user's memory, marker files, `system/init` (`plugins`, `skills`, `agents`, `memory_paths`), and `--include-hook-events`. Each run also read a repo file and a file under `--add-dir`.

| Variant (read-only profile +) | Project config | User hooks | User plugins (skills/agents) | `~/.claude/CLAUDE.md` + rules | Auto memory |
| - | - | - | - | - | - |
| `--setting-sources user` (current `05`) | none | **all run**: SessionStart injects "CAVEMAN MODE ACTIVE" and a previous-session summary; UserPromptSubmit injects hints; Pre/PostToolUse; Stop/SessionEnd | **loaded** (130 / 23) | **loaded** | on |
| `--setting-sources ""` | none | none | none (17 / 5 built-in) | not loaded | on |
| `--settings '{"disableAllHooks": true}'` | none | none | loaded (130 / 23) | loaded | on |
| both of the above | none | none | none (17 / 5) | not loaded | on |
| `--safe-mode` | none | none | two user plugins still listed in `init.plugins`, 17 / 4 | not loaded | off |
| `--restricted` (S2), no `--setting-sources` | none | none | none (17 / 5) | not loaded | off |

- "Project config: none" means: no codeword in the answer, no marker file (project hooks and the `.mcp.json` server never started), project skill absent. T1/T2 hold under every variant.
- In every variant Read/Grep/Glob, `--add-dir`, `dontAsk` and subscription auth worked. Built-in plugins (`cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`) and 17 built-in skills are always present; without the Skill/Agent tools in `--tools` they can't be invoked.
- With the current profile, the user's Stop/SessionEnd hooks run after every task and may write their own files (on this PC: session summaries under `~/.claude/sessions`). On the company laptop that could copy teammates' code into user-level files (T11/T12).

## S2 · `--restricted`

- Works with subscription login (Max). The full read-only task (schema, `--append-system-prompt-file`, `--add-dir` input, repo read) succeeded with `--restricted` instead of `--setting-sources user`.
- It removed everything user-level and project-level in S3 and turned auto memory off; managed settings and `--settings` still apply. File tools are confined to the working directories and `--add-dir`.
- It does not replace the other flags: it only removes command-running tools and WebFetch, so `--tools "Read,Grep,Glob"` stays; the docs ask for `--strict-mcp-config` to skip MCP; `--permission-mode dontAsk` and `--disallowedTools "mcp__*"` stay.
- Consequences: user `settings.json` values (default model, `env`, proxy settings) are ignored, so "Same as Claude Code" (F-18.2) means the account/managed default model, not a model set in the user's `settings.json`. Requires Claude Code ≥ 2.1.248.

## S4 · Edit allow rule in a scratch worktree (ADR-018)

"Own repo" with `src/A.cs`, `src/B.cs`, `src/Zażółć gęślą/C.cs` committed and an uncommitted change in `A.cs`. Per run: `git stash create` → SHA → `git worktree add --detach "<scratch>\fix <form>" <sha>`; fix profile (`--tools "Read,Grep,Glob,Edit" --allowedTools "Edit(<rule>)" --permission-mode dontAsk` + the rest of the read-only profile), cwd = scratch worktree; the prompt asks for edits in all three files; then `git status` in the scratch worktree, a check of the user's checkout, `git worktree remove --force` + `prune`.

| Rule | Changed in scratch | Denied |
| - | - | - |
| `Edit(/src/A.cs)` (anchored to the session's working directory) | `src/A.cs` only | B, C |
| `Edit(src/A.cs)` | `src/A.cs` only | B, C |
| `Edit(./src/A.cs)` | `src/A.cs` only | B, C |
| `Edit(//c/Users/…/scratch worktrees/fix absolute/src/A.cs)` | `src/A.cs` only | B, C |
| `Edit(/src/Zażółć gęślą/C.cs)` | `src/Zażółć gęślą/C.cs` only | A, B |
| `Edit(/src/A.cs)` with `--restricted` | `src/A.cs` only | B, C |
| `Edit(src\A.cs)` (backslash) | nothing | A, B, C |

- In every run: the uncommitted change was present in the scratch worktree, the user's checkout (status and file hash) was untouched, and the only tools were Edit, Glob, Grep, Read (no Write, MultiEdit, NotebookEdit). Denials are listed in `permission_denials`; the model said it would not work around them.
- Rules use gitignore syntax (permissions docs): a bare file name such as `Edit(A.cs)` matches at any depth, so the runner should use the anchored form `/<path relative to the scratch worktree>` with forward slashes and gitignore special characters (`*`, `?`, `[`, `]`, leading `!`/`#`, trailing spaces, `\`) escaped.

## Side observations
- Node 24.13 `fs.rmSync(dir, { recursive: true })` silently did nothing on a path with Polish characters on Windows; the spike removes trees by hand. The app is Rust, but Node test tooling should not rely on `rmSync` for such paths.
