# 08 · Decisions (ADR log)

Decisions already made during design. Do not reverse one silently: if implementation shows a decision is wrong, stop, explain the evidence, and add a new ADR that supersedes it after the owner agrees.

Format: context → decision → consequences.

### ADR-001 Tauri 2 with a React UI and a Rust core
Context: needs to be fast, look custom, run on Windows, render large diffs. Team writes C#/XAML, but language was left open in favour of speed and quality.
Decision: Tauri 2 (WebView2) with React + TypeScript for the UI and Rust (tokio) for everything else.
Rejected: Electron (heavier, slower start, more memory), Avalonia/WPF/MAUI (less design freedom, no good read-only diff control, MAUI has no code editor control), GPU-native frameworks like Zed's GPUI (immature for this use).
Consequences: Rust learning curve; Windows WebView2 dependency (present on Windows 10/11).

### ADR-002 Claude through the `claude` CLI with the user's own login
Context: the organization has Claude Code Enterprise seats and no API key. The Agent SDK needs an API key.
Decision: run `claude -p` as a subprocess per task, with each developer's own login, structured output via `--json-schema`, follow-ups via `--resume`.
Consequences: usage counts against each user's seat; startup checks for version and auth; **risk**: the docs announce `--bare` (which ignores subscription login) becoming the default for `-p`. Mitigation: the runner never relies on implicit defaults, the probe runs after every Claude Code update, and the team pins/updates Claude Code deliberately. If `-p` stops working with subscription login, escalate before writing workarounds.

### ADR-003 Claude is read-only on others' code; edits only own code, one file, accepted by the user
Decision: read-only invocation profile for every task on a teammate's MR; Fix with Claude only in self-review and author mode, restricted to one file, verified after the run, and applied only after Accept.

### ADR-004 Publish, approve, resolve and reply are separate actions
Decision: drafts are local until Publish (GitLab draft notes + bulk publish, one notification); approval is independent from comments; resolving threads is immediate and independent; author replies go out immediately except "Fixed in <sha>" replies, which wait for the push (ADR-014).

### ADR-005 A separate worktree per reviewed MR head
Decision: teammates' MRs are checked out in app-managed worktrees; the user's own checkout is never switched, reset or modified. Claude, the code index and Rider (by default) use the worktree.

### ADR-006 git CLI instead of libgit2
Decision: shell out to git ≥ 2.40 for everything (worktrees, range-diff, merge-tree, apply). Behaviour then matches what developers see in their terminal and Rider. Parsing is done in Rust with tests on fixture repositories.

### ADR-007 Own read-only, virtualized diff renderer
Decision: no Monaco/CodeMirror diff editor. Own React renderer (TanStack Virtual, Shiki in a worker) to get inline note/thread cards, gutter markers, fold and moved rows, and full design control with good performance.

### ADR-008 Staging checkboxes are the git index
Decision: checkbox state is read from and written to the index (`git apply --cached`), never kept as separate app state, so Rider and the app always agree.

### ADR-009 Coverage is enforced by code, not by the prompt
Decision: the core guarantees every hunk is in exactly one step or skim group; anything Claude misses goes to "Other".

### ADR-010 Two modes and three layouts over one state
Decision: Focus (layouts A Sidebar, B Minimal, C Guide) and Detailed are views of the same session; switching never loses position or decisions.

### ADR-011 English UI, configurable Claude output language
Decision: all UI copy in English; Claude writes notes, comments, commit messages and descriptions in the language chosen in Settings (English or Polish).

### ADR-012 Visual language: dark color blocks, not GitHub
Decision: flat color blocks (yellow, green, purple, orange, blue, white) on near-black, Barlow Condensed headings, square corners, fills instead of borders, word tags instead of letter badges (no "M/A/D").

### ADR-013 Team rules come from the target branch and change only through an MR
Decision: `.review/rules.md` is read at the base SHA; suggestions from repeated dismissals become an MR to that file.

### ADR-014 "Fixed in <sha>" replies are queued until the push succeeds
Decision: the reply references a commit that must exist on the server; the app stores it in `queued_replies` and sends it right after a successful push (and resolves the thread if chosen).

### ADR-015 Moved-code detection is implemented in the core
Decision: own algorithm that also reports small changes inside moved blocks; git's `--color-moved` is used as a test oracle.

### ADR-016 A mock backend for the UI
Decision: `src/ipc/mock/` implements the same IPC interface with fixture data taken from the design mocks. The UI is developed and end-to-end tested in a normal browser; the real backend is tested in Rust.

### ADR-017 Toast buttons activate deep links
Decision: toast actions are protocol activations (`guidedreview://…`), so there is one code path for links from toasts, Rider and the browser.

---

## Spike notes (fill in during M0)

| Spike | Question | Result | Date |
| - | - | - | - |
| S1 | Does `claude -p` with our read-only flags work with the Enterprise login on Windows? Output fields, exit codes, session resume. | | |
| S2 | Does `--restricted` work with the Enterprise login? If yes, does it replace our flag set? | | |
| S3 | Is the worktree's `CLAUDE.md` loaded under our flags? How do we exclude it? | | |
| S4 | Does `--allowedTools "Edit(<path>)"` + `--permission-mode dontAsk` block edits to other files? Exact path syntax. | | |
| S5 | GitLab instance version; draft notes + bulk publish; approve with `sha`; reviewer filter on MR list; `draft` param on create. | | |
| S6 | reqwest TLS against the on-prem GitLab with the Windows certificate store. | | |
| S7 | Tauri: deep-link + single-instance on Windows; notification action buttons; tray window positioning. | | |
| S8 | csharp-ls on the MAUI solution: restore time, memory, hover/definition/references quality. | | |
| S9 | Rider: install path(s) on team machines, External Tools config location and format. | | |
