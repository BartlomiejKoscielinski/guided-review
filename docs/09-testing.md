# 09 · Testing and verification

Goal: every acceptance criterion in `01-product.md` is covered by at least one automated test or one manual check, and the IDs make that traceable.

## Naming = traceability
- Rust: `#[test] fn f06_10_missing_hunks_go_to_other_step()`.
- Vitest / Playwright: `it('F-06.10 missing hunks go to the Other step', …)`.
- Manual checks: listed below with their IDs.
- `/audit` (skill) greps IDs in `docs/01-product.md`, tests and `docs/PROGRESS.md` and reports gaps. It must find Rust test names with a suffix (`f06_10_…`) and tests inside module files (`#[cfg(test)] mod tests`); fixed at the start of M0.

## Layers

| Layer | Tool | What |
| - | - | - |
| Core unit | `cargo test` | diff parser, hunk IDs, intraline, coverage invariant, plan validation, range-diff parser, moved detection, staging patch builder, draft position mapping, cache keys, deep-link parser, redaction |
| Core integration | `cargo test` + fixture repos | worktree lifecycle, stage/unstage/commit/fixup, merge-tree conflict check, range-diff on a rebased MR, replay of old commits |
| GitLab client | `cargo test` + `wiremock` | every endpoint in `05-integrations.md`, pagination, 401/403/404/429 handling, retries; responses are cassettes recorded from the stand-in GitLab |
| Claude runner | `cargo test` + fake `claude` | flags per profile (snapshot test of argv, `--restricted`), Edit rule escaping, environment cleanup when `CLAUDECODE` is set, stdin prompt, JSON parsing, error mapping (`is_error`, 429, sign-in texts, 404), `permission_denials` on task inputs, schema violations and evidence checks, cancellation kills the tree, Fix guard restores on extra edits |
| UI components | Vitest + Testing Library | design-system components, DiffView rows, keyboard handling, a11y roles |
| UI flows | Playwright against the mock backend (`npm run dev:mock`) | one spec per screen with its AC IDs; layout A/B/C; mode switch keeps state; publish/approve separation |
| Visual | `/design-check S-xx` | screenshot of the implemented screen (mock backend, same data) next to `docs/design/screens/*.png`; differences listed and fixed or justified. During milestones a structure check (copy, design rules, regions); the pixel pass (`/design-check S-xx pixel`) once per screen in M11 (ADR-026) |
| Real app | `tools/app-driver/app.mjs` (skill `/app`) | `tauri dev` with the real backend and the stand-in, driven by Claude Code through Playwright over WebView2 CDP (`127.0.0.1:9222`, dev build only); smoke checks of wired screens, real-backend states, before ticking stand-in criteria; native windows (file picker, Rider, tray) stay manual |
| Performance | scripted | 10,000-line diff scroll (no frame > 32 ms in a Playwright trace), 1,000-file tree render < 100 ms, cached session open < 300 ms |
| Claude quality | `npm run eval:claude` (manual, uses your seat; `src-tauri/tests/it/eval_claude.rs`, Sonnet · low unless `GR_EVAL_MODEL` / `GR_EVAL_EFFORT`) | golden inputs from fixture MRs → plan covers all hunks, findings cite real lines, no findings outside the step, schema valid, no note repeats an existing thread on its line (F-09.5) |

## Environments (ADR-019)

| Layer | Where | GitLab | Claude | When |
| - | - | - | - | - |
| 1 · Automated | development PC | `wiremock` with cassettes | `fake-claude` | every commit (`npm run verify`) |
| 2 · Stand-in integration | development PC | **stand-in GitLab**: GitLab EE 17.11.7-ee (the on-prem version) in Docker on the PC, `https://localhost:8443` (`tools/standin/`), test users and a sandbox project with synthetic code (the fixture MAUI-like project pushed there) | real `claude`, personal account, **fixture repos only** | per milestone, before ticking GitLab- or Claude-facing criteria |
| 3 · Field check | company laptop | on-prem GitLab over VPN, in a sandbox project the user created | Claude Enterprise | field visits listed in `07` |

Rules:
- No company code, MR content, names or hostnames on the development PC, and nothing of the company through the personal Claude account (T11).
- Cassettes are recorded from the stand-in only. On-prem contributes a **key-set diff** per endpoint (JSON keys and types, never values). A difference becomes a new cassette variant and a test.
- The app has no test-only code paths: the stand-in and on-prem differ only in the server URL and token.
- Internal CA on the PC: a test CA and a local HTTPS test server check that the app trusts certificates from the Windows store. The user imports and later removes the test CA in `CurrentUser\Root`; the real proof is the TLS check at field visit 1. The stand-in has its own test CA (`cargo run --example standin_cert`), which stays in `CurrentUser\Root` while the stand-in is used; its private key is never stored.
- The stand-in listens on `127.0.0.1` only (an older release must not face the network) and follows the on-prem version when it is upgraded.
- Pipelines on the stand-in (M6) run on a `gitlab-runner` next to it on the PC (set up in M6).

## Field kit

- `field/RUNBOOK-<n>.md`: numbered steps for one visit (15–30 min), written so the user or the laptop's Claude Code can execute them.
- `gr-probe.exe` (`src-tauri/src/bin/gr-probe.rs`), built on the PC, reuses `os/process.rs`, `claude/runner.rs`, the GitLab client and TLS setup. Subcommands: `claude` (S1–S4 on a synthetic fixture repo it creates, with canaries), `gitlab read` (version, user, MR lists and filters, approvals fields, pagination headers, TLS), `gitlab write` (draft note, bulk publish, approve/revoke, play a manual job; only in the named sandbox project, confirmation before each call), `env` (Claude Code path and version, Rider paths, git version).
- The on-prem token is typed in the terminal (hidden) or read from Credential Manager; it is never written to a file or the report.
- Output: `field/reports/visit-<n>.json` + `.md`, sanitized as in T11; the user reviews it before it leaves the laptop.
- From M2 on, visits also use a portable build of the app (`GuidedReview.exe`, no installer: `npm run build:portable` = `tauri build --no-bundle`; data in `%APPDATA%` like the installed app, no deep-link registration) and go through the `[field]` items of the manual checklist; manual results go into a checklist template (`field/checklist-<n>.md`) with yes/no and fixed failure kinds only.

## Fixture repositories
`fixtures/` contains a Rust test helper (or `cargo run --bin make-fixtures`) that builds repositories in a temp folder: a small MAUI-like project; an MR branch with renames, a moved method with one changed line, whitespace-only changes and a `.resx` edit; a second version of the same MR rebased onto a moved target branch with one changed commit, one new commit and one dropped commit. No bash scripts (Windows).

## Fake `claude`
A tiny test binary `fake-claude` (in `src-tauri/tests/bin/`) that records its argv, stdin and the files of its `--add-dir` folder to `calls.jsonl` and prints canned responses from `fake-claude.json`; both files sit next to the executable, and every test copies the binary into its own folder as `claude.exe` (`tests/support/fake_claude.rs`), so tests run in parallel without shared environment variables. The runner's executable path is configurable (`claude.path`), so tests point it at that copy.

## Mock backend data
`src/ipc/mock/fixtures/` holds data matching the design mocks (MR !482 "Offline queue for delivery photos", Marta K., 8 steps, findings f1–f4, threads, pipelines #18342/#18321/#18320, MR !471 versions, MR !480 threads, etc.). With the same data the implementation can be compared with the mock screenshots one to one.

## Manual checklist (Windows integration, before each release)
Items tagged `[field]` are checked on the company laptop during a field visit (on-prem GitLab, Claude Enterprise); the others can be checked on the development PC.
- [ ] F-30.1 Title bar on the real exe: drag moves the window, double-click maximizes and restores, edges and corners resize, Win+arrows and dragging to the top edge snap; also on a second monitor with another scale.
- [ ] F-30.4 Restarting keeps size, position and maximized state (no growth); a position saved on a disconnected monitor or with the title bar off-screen comes back onto the primary monitor; the last screen comes back.
- [ ] F-15.5 Open in Rider in S-06 opens the working-copy file at the first line of the shown hunk.
- [ ] F-16.2 Staging a hunk in Rider updates the S-06 checkboxes within a second, and the other way round.
- [ ] F-18.1 Sign in to Claude Code opens a console with `claude auth login`; after signing in and returning to the app the status reads "Claude Code: signed in".
- [ ] F-24.1 Open in Rider opens the right file and line (worktree file for teammates' MRs). `[field]`
- [ ] F-24.2 `guidedreview://mr/<iid>` from a browser opens the running app on the plan; a second link focuses the same window.
- [ ] F-24.3 External Tools appear in Rider after restart and open the app on the current branch. `[field]`
- [ ] F-28.1 Closing the window keeps the tray icon; the badge count matches the tray menu.
- [ ] F-28.3 Toast buttons open the right screen; Later snoozes 30 minutes.
- [ ] F-28.5 Quiet hours suppress toasts, keep the badge.
- [ ] F-19.1 Start with Windows works after reboot.
- [ ] NFR-04 Token is in Credential Manager, not in the DB or logs (search the app data folder for `glpat-`). `[field]`
- [ ] NFR-07 Installer installs and uninstalls cleanly; deep-link scheme registered and removed. `[field]`
- [ ] F-18.1 Claude Code status and both profiles work with Claude Enterprise (S1–S4 re-run, incl. `--restricted`, ADR-022). `[field]`
- [ ] F-19.5 Check and save accepts the on-prem token through the internal CA. `[field]`
- [ ] F-02.1 Waiting for me / Mine / All open match the on-prem MR lists. `[field]`
- [ ] F-12.5 Publishing drafts in the on-prem sandbox sends one notification. `[field]`
- [ ] F-14.2 Approve sends the reviewed SHA; a stale SHA is refused and offers S-09. `[field]`
- [ ] F-20.6 A manual job with a variable plays in the on-prem sandbox. `[field]`
- [ ] F-23.5 csharp-ls indexes the real MAUI solution (S8 timings within NFR-01 budgets). `[field]`
