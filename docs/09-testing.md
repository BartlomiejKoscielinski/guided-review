# 09 · Testing and verification

Goal: every acceptance criterion in `01-product.md` is covered by at least one automated test or one manual check, and the IDs make that traceable.

## Naming = traceability
- Rust: `#[test] fn f06_10_missing_hunks_go_to_other_step()`.
- Vitest / Playwright: `it('F-06.10 missing hunks go to the Other step', …)`.
- Manual checks: listed below with their IDs.
- `/audit` (skill) greps IDs in `docs/01-product.md`, tests and `docs/PROGRESS.md` and reports gaps.

## Layers

| Layer | Tool | What |
| - | - | - |
| Core unit | `cargo test` | diff parser, hunk IDs, intraline, coverage invariant, plan validation, range-diff parser, moved detection, staging patch builder, draft position mapping, cache keys, deep-link parser, redaction |
| Core integration | `cargo test` + fixture repos | worktree lifecycle, stage/unstage/commit/fixup, merge-tree conflict check, range-diff on a rebased MR, replay of old commits |
| GitLab client | `cargo test` + `wiremock` | every endpoint in `05-integrations.md`, pagination, 401/403/404/429 handling, retries |
| Claude runner | `cargo test` + fake `claude` | flags per profile (snapshot test of argv), stdin prompt, JSON parsing, `is_error`, schema violations, cancellation kills the tree, Fix guard restores on extra edits |
| UI components | Vitest + Testing Library | design-system components, DiffView rows, keyboard handling, a11y roles |
| UI flows | Playwright against the mock backend (`npm run dev:mock`) | one spec per screen with its AC IDs; layout A/B/C; mode switch keeps state; publish/approve separation |
| Visual | `/design-check S-xx` | screenshot of the implemented screen (mock backend, same data) next to `docs/design/screens/*.png`; differences listed and fixed or justified |
| Performance | scripted | 10,000-line diff scroll (no frame > 32 ms in a Playwright trace), 1,000-file tree render < 100 ms, cached session open < 300 ms |
| Claude quality | `npm run eval:claude` (manual, uses your seat) | golden inputs from fixture MRs → plan covers all hunks, findings cite real lines, no findings outside the step, schema valid |

## Fixture repositories
`fixtures/` contains a Rust test helper (or `cargo run --bin make-fixtures`) that builds repositories in a temp folder: a small MAUI-like project; an MR branch with renames, a moved method with one changed line, whitespace-only changes and a `.resx` edit; a second version of the same MR rebased onto a moved target branch with one changed commit, one new commit and one dropped commit. No bash scripts (Windows).

## Fake `claude`
A tiny test binary `fake-claude` (in `src-tauri/tests/bin/`) that records its argv and stdin to a file and prints a canned JSON response chosen by an env var. The runner's executable path is configurable, so tests point it at `fake-claude`.

## Mock backend data
`src/ipc/mock/fixtures/` holds data matching the design mocks (MR !482 "Offline queue for delivery photos", Marta K., 8 steps, findings f1–f4, threads, pipelines #18342/#18321/#18320, MR !471 versions, MR !480 threads, etc.). With the same data the implementation can be compared with the mock screenshots one to one.

## Manual checklist (Windows integration, before each release)
- [ ] F-24.1 Open in Rider opens the right file and line (worktree file for teammates' MRs).
- [ ] F-24.2 `guidedreview://mr/<iid>` from a browser opens the running app on the plan; a second link focuses the same window.
- [ ] F-24.3 External Tools appear in Rider after restart and open the app on the current branch.
- [ ] F-28.1 Closing the window keeps the tray icon; the badge count matches the tray menu.
- [ ] F-28.3 Toast buttons open the right screen; Later snoozes 30 minutes.
- [ ] F-28.5 Quiet hours suppress toasts, keep the badge.
- [ ] F-19.1 Start with Windows works after reboot.
- [ ] NFR-04 Token is in Credential Manager, not in the DB or logs (search the app data folder for `glpat-`).
- [ ] NFR-07 Installer installs and uninstalls cleanly; deep-link scheme registered and removed.
