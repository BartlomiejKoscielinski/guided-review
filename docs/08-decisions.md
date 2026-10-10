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
Decision: read-only invocation profile for every task on a teammate's MR; Fix with Claude only in self-review and author mode, restricted to one file, verified after the run, and applied only after Accept. How the fix runs: ADR-018.

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

### ADR-018 Fix with Claude runs in a scratch worktree (implements ADR-003)
Context: the first design let Claude edit the file in the user's working copy and restored it on a guard violation. The edit was then on disk (visible to Rider, the watcher and builds) before Accept, and a user edit made during the run could be lost on Discard. That contradicts "applied only after the user accepts".
Decision: the app creates an app-managed scratch worktree from `git stash create` (a commit object with the tracked uncommitted changes; the checkout is not touched), or from HEAD when the tree is clean, plus untracked copies of the target file if needed. Claude runs there with the fix profile. The app diffs the scratch worktree, enforces "only that one file changed", and shows the proposal. Accept writes the new content into the working copy only if the file's hash still equals the snapshot; otherwise it reports "The file changed while Claude worked. Run it again." Discard removes the scratch worktree.
Consequences: the user's working copy is touched only on Accept; S4 is tested in this setup; one extra worktree per fix (removed afterwards).

### ADR-019 Two machines: development PC and field visits on the company laptop
Context: the on-prem GitLab is reachable only over VPN from the company laptop, which also has Claude Enterprise, Rider and the MAUI solution. Development happens on a personal PC with a personal Claude Max account.
Decision: (1) no company code, MR content, names or hostnames are processed on the development PC, and nothing of the company goes through the personal Claude account; the PC uses only synthetic data (fixture repos, our own sandbox project). (2) A **stand-in GitLab** on gitlab.com (free account, private sandbox project with synthetic code) gives real API semantics during development; the app code is identical, only the server URL differs. (3) **Field visits** on the laptop run a field kit (`gr-probe.exe` + runbook, later a portable `GuidedReview.exe`) against the on-prem GitLab and Claude Enterprise; the report that comes back holds only versions, yes/no results, status codes, header names, JSON key sets and types, and timings, with hostnames and users replaced by placeholders. (4) GitLab cassettes for tests are recorded from the stand-in only; on-prem contributes a key-set diff.
Consequences: some criteria are proven in two steps (layers 1–2 on the PC, `[field]` checks on the laptop, see `09`); differences between gitlab.com (current version, Free tier) and on-prem are caught at visits; a GitLab CE container pinned to the on-prem version can be added later if the gap is large.

### ADR-020 App identity
Decision: product name "Guided Review", executable `GuidedReview.exe`, Tauri identifier `com.inpost.guidedreview`, app data folder `%APPDATA%\GuidedReview\` resolved explicitly by the core (Tauri plugins that keep their own small state files, such as window-state, use `%APPDATA%\com.inpost.guidedreview\`). Deep-link scheme `guidedreview://`, keyring service `GuidedReview`. The app icon is generated with `tauri icon` from the mock's logo mark (black "H" on the yellow square).

### ADR-021 Claude Code executable discovery on Windows
Context: the npm install exposes `claude.cmd`, which can only run through `cmd.exe` (fragile quoting of the JSON schema argument, an extra process layer), while Rust resolves a bare `claude` to `claude.exe` only.
Decision: prefer the native `claude.exe` (Settings value → `%USERPROFILE%\.local\bin\claude.exe` → `claude.exe` on PATH). If only an npm install exists, run `node <npm prefix>\node_modules\@anthropic-ai\claude-code\cli.js` directly. Never spawn `claude.cmd` through `cmd.exe`. Settings › Claude shows the resolved path and version (F-18.6). The team standard is the native installer.

---

## Spike notes (fill in during M0)

Every result names where it was measured: **PC/Max** (development PC, personal Claude Max, stand-in GitLab), **Laptop/Enterprise** (field visit, Claude Enterprise, on-prem GitLab), and the tool versions. S1–S3 count as done only with a Laptop/Enterprise result (field visit 1).

| Spike | Question | Where | Result | Date |
| - | - | - | - | - |
| S1 | Does `claude -p` with our read-only flags work with subscription login on Windows? Output fields (`result`, `structured_output`, `session_id`, `is_error`), exit codes, `--resume`, stream-json with `--json-schema`; are draft-07 keywords (`maxLength`, `pattern`) enforced; does `--append-system-prompt-file` exist; can Read open files outside cwd under `dontAsk` (with/without `--add-dir`); `--tools ""`; `--disallowedTools "mcp__*"`; model IDs and supported efforts per model; spawn of `claude.exe` with argument arrays (ADR-021). | PC/Max, then Laptop/Enterprise | | |
| S2 | Does `--restricted` work with subscription login? If yes, does it replace our flag set? | PC/Max, then Laptop/Enterprise | | |
| S3 | Is the worktree's `CLAUDE.md` / `AGENTS.md` loaded under our flags? Do project hooks or `.mcp.json` run? Which **user-level** config is loaded (`~/.claude/settings.json` hooks and plugins, `~/.claude/CLAUDE.md`), and can `--setting-sources ""` or `--settings '{"disableAllHooks": true}'` suppress it? | PC/Max, then Laptop/Enterprise | | |
| S4 | Does `--allowedTools "Edit(<path>)"` + `--permission-mode dontAsk` block edits to other files in the scratch worktree (ADR-018)? Exact path syntax incl. spaces and Polish characters. | PC/Max, Laptop/Enterprise | | |
| S5 | GitLab version and tier; draft notes with positions + bulk publish (incl. a position-less summary draft, one notification); approve with `sha` (also a stale `sha`); `/approvals` fields; reviewer and approver filters on MR lists; `draft` param on create; manual job description and variables; `x-next-page`. | stand-in, then Laptop (on-prem sandbox) | | |
| S6 | reqwest TLS with the Windows certificate store (`rustls-platform-verifier` vs `native-tls`) against an internal CA. | PC (test CA), then Laptop (on-prem) | | |
| S7 | Tauri: deep-link + single-instance on Windows; toast action buttons (plugin vs `windows` crate, AUMID for unpackaged/dev builds); tray window positioning (taskbar edges, DPI, second monitor); custom title bar drag, double-click, resize, Snap. | PC | | |
| S8 | csharp-ls on the MAUI solution: restore time, memory, hover/definition/references quality. **Deferred to M9 (field visit 4b).** | Laptop | | |
| S9 | Rider: install paths (Toolbox vs standalone), `--line`/`--column`, External Tools config location and XML format, macros (`$ProjectFileDir$`, whether `$SelectedText$` yields a commit SHA). | PC (Rider installed like on the laptop), then Laptop (paths) | | |
