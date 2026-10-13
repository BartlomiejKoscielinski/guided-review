# Guided Review

Windows desktop app (Tauri 2: React + TypeScript UI, Rust core) that walks a developer through a code change step by step: a teammate's GitLab merge request, a commit, or their own local changes. Claude runs through the user's own Claude Code login (`claude -p`), never an API key. The full specification is in `docs/`; the designs are in `docs/design/`. Build what the docs describe; do not redesign.

## Read before coding

| When | Read |
| - | - |
| Always, at the start of a session | `docs/README.md`; from `docs/PROGRESS.md` only the current milestone's checklist and the last two session-log rows (`grep -n '^## ' docs/PROGRESS.md`, then Read with offset/limit; never the whole file); the milestone in `docs/07-roadmap.md` |
| Building a feature | its `F-xx` section in `docs/01-product.md` (acceptance criteria are the contract) |
| Building or changing a screen | its `S-xx` section in `docs/02-screens.md`, the PNGs in `docs/design/screens/`, the mock in `docs/design/mocks/` (exact styles), `docs/03-design-system.md` |
| Rust core, IPC, data, processes | `docs/04-architecture.md` |
| git, GitLab, Claude Code, LSP, Rider, Windows APIs | `docs/05-integrations.md` (items marked **verify** must be checked in current docs first) |
| Anything touching Claude, tokens, links, processes | `docs/06-security.md` |
| Before changing an approach | `docs/08-decisions.md` |
| Tests, the stand-in GitLab, field visits | `docs/09-testing.md` (Environments, Field kit) |

## Commands (create them in M0, keep them working)

- `npm install` · `npm run dev:mock` (UI in the browser with the mock backend) · `npm run tauri dev` (full app)
- `npm run verify` = typecheck + eslint + `prettier --check` + vitest + `cargo fmt --check` + `cargo clippy -- -D warnings` + `cargo test`
- `npm run e2e` (Playwright against the mock backend) · `npm run gen:types` (ts-rs → `src/ipc/types/`)
- `node tools/mock-preview/render-mock.mjs <Mock.dc.html> --state '<json>' --out <png>` (render a design mock)
- `node tools/mock-preview/design-check.mjs S06` (/design-check data in one run: shots, mock render, pixel heatmap, DOM/style comparison)
- `node tools/audit.mjs [--milestone M3]` (acceptance criteria vs PROGRESS vs tests)
- `node tools/app-driver/app.mjs start | snap | click <selector> | shot | stop` (drive the real app over WebView2 CDP; skill `/app`)

## How to work

1. One milestone per branch. Start with `/milestone Mx`: it plans first (acceptance-criteria IDs → tasks → tests) and waits for approval.
2. Small commits: `M3: F-06.4 F-06.5 strategy toggle and drag reorder`.
3. Tests carry the AC ID in their name (`f06_10_…` in Rust, `'F-06.10 …'` in TS).
4. A screen is built against the **mock backend first**, compared with its PNG (`/design-check S-xx`), then wired to the real backend and checked in the real app with `/app` (Claude drives it; don't ask the owner to click).
5. Before saying a task is done: `/verify`; for UI changes also `/design-check`; at the end of a milestone `/audit`.
6. End every session with `/handoff`: it updates `docs/PROGRESS.md` (ticks with commit SHA, a session-log line) and writes the prompt for the next session.
7. If the spec is unclear, contradictory or seems wrong: stop and ask. Propose the doc change; never silently pick an interpretation. If a decision in `08-decisions.md` looks wrong, explain why and wait.
8. If you are not sure about a library or CLI API (Tauri plugins, csharp-ls, GitLab endpoint, Claude Code flag): read its current docs before writing code and note the version in the commit message or spike notes.
9. Don't add dependencies without saying why in the plan.
10. Keep sessions short: one phase per session (plan · core · one screen with its design-check · wrap-up). When a phase ends with a commit, run `/handoff` and suggest a new session instead of continuing. Read docs by section (grep headings, Read with offset/limit); filter command output (`tools/verify.mjs`, `grep`, `tail`); open images only as crops.

## Non-negotiables

- **Claude on others' code is read-only.** All `claude` invocations are built only in `src-tauri/src/claude/runner.rs` with the profiles from `05-integrations.md` (`--tools "Read,Grep,Glob"`, `--permission-mode dontAsk`, `--restricted` (ADR-022), `--strict-mcp-config`, `--disallowedTools "mcp__*"`). Never `--bare` (breaks subscription login), never `--dangerously-skip-permissions`, never Bash for Claude.
- **Fix with Claude only on own code** (self-review, own MR), one file, run in an app-managed scratch worktree (ADR-018), verified after the run, written to the working copy only after the user accepts.
- **No company data on this PC** (ADR-019). Development and tests here use synthetic data only (fixture repos, the stand-in GitLab sandbox project). Never point the app, `claude` or a test at company repositories or the on-prem GitLab from this machine. Field kit reports carry no code, names or hostnames.
- **Nothing reaches GitLab without an explicit click.** Publish, approve, resolve, reply, run pipeline, play job are separate actions. Approve sends the reviewed SHA. No shortcut approves.
- **Never touch the user's checkout** with reset, clean, checkout of other branches, rebase or force-push. Teammates' code lives in app-managed worktrees.
- **Secrets:** GitLab token only in Windows Credential Manager (`keyring`); never in SQLite, logs, IPC payloads or error messages.
- **Processes:** argument arrays only (no shell, never `.cmd` through `cmd.exe`; `claude` discovery per ADR-021), `CREATE_NO_WINDOW`, Job Object for cancellation, prompts via stdin.
- **Coverage invariant:** every hunk is in exactly one step or skim group (`review/coverage.rs`), whatever Claude returns.
- **UI:** only tokens from `src/styles/tokens.css`; square corners; fills not borders; word tags not letters; Barlow Condensed uppercase for headings/buttons/tags; English copy exactly as in the specs and mocks.
- **IPC:** types generated by ts-rs; every command exists in both `src/ipc/tauri.ts` and `src/ipc/mock/`.

## Code conventions

- TypeScript strict, no `any`, function components, one component per file, screens in `src/screens/<screen>/`. Server state via TanStack Query hooks in `src/ipc/hooks/`; UI state via zustand.
- Rust: `thiserror` errors per module mapped to `AppError`; no `unwrap()`/`expect()` outside tests and startup; `tracing` for logs; core logic independent of Tauri (unit-testable).
- Windows first: paths with `std::path`, no hard-coded `/`; test with spaces and Polish characters in paths and names.
- Keep files under ~400 lines; split by responsibility.

## Environment

Two machines (ADR-019):
- **Development PC (here):** Windows 11, PowerShell, Node LTS, Rust stable (MSVC) with VS Build Tools, git ≥ 2.40, Claude Code from the native installer (`%USERPROFILE%\.local\bin\claude.exe`), signed in with a personal account (`claude auth status`), Rider (installed like on the laptop, for S9), .NET SDK. GitLab = the **stand-in**: GitLab EE 17.11.7-ee (the on-prem version) in Docker, `https://localhost:8443`, synthetic data only (`tools/standin/README.md`). No VPN, no access to the company GitLab.
- **Company laptop (field visits only):** VPN to the team's on-prem GitLab with an internal CA, Claude Enterprise, Rider, the MAUI solution, `csharp-ls` from M9. It clones this repo and runs `field/RUNBOOK-<n>.md` with `gr-probe.exe`; only the sanitized report comes back.
