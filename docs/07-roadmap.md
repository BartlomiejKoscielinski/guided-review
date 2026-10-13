# 07 · Roadmap

Twelve milestones. Each one ends with a working app you can use and demo; nothing is built "for later" without a consumer. Work on one milestone per branch (`m3-plan-and-focus`), with the `/milestone` skill. A milestone is done when every acceptance criterion listed for it is ticked in `PROGRESS.md` with a commit SHA, `/verify` passes, `/design-check` was run for its screens, and `/audit` shows no gaps for it.

Dependencies: M0 → M1 → M2 → M3 → (M4, M5) → M6 → M7 → M8 → M9 → M10 → M11. M4 and M5 can swap.

**Criteria that point at later milestones.** Some criteria lead to a screen or service that a later milestone builds (e.g. F-16.5 → S-11, F-06.1 → S-08). Such a criterion is ticked when its own part works and it navigates to the target route, which is a stub until its milestone. The target's behaviour is covered by the target's own criteria. Title-bar controls whose behaviour belongs to a later milestone are rendered as static placeholders until then.

**Two machines.** Code is written and tested on the development PC with synthetic data and a stand-in GitLab; the real environment (on-prem GitLab over VPN, Claude Enterprise, Rider, the MAUI solution) is checked during **field visits** on the company laptop. See `09-testing.md` › Environments and ADR-019. A milestone with a field visit is done only after the visit's report is merged.

---

## M0 · Foundations and spikes
**Goal:** the project skeleton exists, risky integrations are proven, and the shell looks like the mocks.
- First commit: fix `tools/audit.mjs` so it finds Rust test names (`f06_10_…`) and tests inside module files.
- Tauri 2 + React + TS strict + Vite with the app identity from `04` › App identity; Rust workspace layout from `04-architecture.md`; lint/format/typecheck/test scripts (`npm run verify`, incl. Prettier).
- `tokens.css`, fonts via @fontsource, base styles; components: TitleBar (custom, draggable, caption buttons), Dock, Button, Tag, Square, Kbd, Segmented, Switch, ModelChip.
- Routes stubbed for S-01…S-11 with the shell; IPC client interface with **mock** and **tauri** implementations; `ts-rs` type generation.
- AppError, logging (tracing, size rotation, redaction), settings store (SQLite + migrations, keys from `04` › Settings), window state and last-screen restore; `os/process.rs` skeleton (argument arrays, `CREATE_NO_WINDOW`, Job Object).
- Install Playwright and re-render the PNGs whose mocks changed at kickoff (see `design/README.md` › Pending re-renders).
- Spikes S1–S7 and S9 from `08-decisions.md` with results written there; S8 is deferred to M9 (field visit 4). Claude spikes S1–S4 run first, on the PC (Max); S5/S6 run against the stand-in GitLab; S9 on the PC with Rider installed. Adjust `05-integrations.md` if a spike disproves something (and say so in the PR).
- Field kit: `gr-probe.exe` + `field/RUNBOOK-1.md` (`09` › Field kit). **Field visit 1** on the laptop (S1/S2/S3 on Claude Enterprise, S4, S6 against the internal CA, S5 read and write in the on-prem sandbox project, S9 paths and version) is postponed to the end of M2 and done together with field visit 2 (owner's decision 2026-10-12): until then the spike results are PC/Max and stand-in only.
- Features: F-30.1, F-30.2, F-30.4, F-19.4, NFR-08.
- Demo: app starts, dock switches between stub screens, Review tile dimmed without a session, Settings tile purple, `Ctrl+,` works, window and last screen restored; spike table filled on the PC and the stand-in (S8 deferred; Laptop/Enterprise results come with field visit 1 at the end of M2).

## M1 · Local changes, diff renderer, commit
**Goal:** a useful daily tool even without GitLab: browse local changes and a commit, stage hunks/lines, commit with a Claude-suggested message.
- git runner, status/diff/log parsing, hunk IDs, intraline emphasis; virtualized file tree; DiffView (unified + split, Shiki worker, line numbers, hunk headers); staging patch builder; commit/amend/push.
- Claude runner (read-only profile), queue, commit-message task, Settings › Claude (needed for model/effort).
- Features: F-15 (all), F-16 (all), F-05.2, F-05.3, F-05.7, F-18 (all), F-30.5. Diff colors stay on the default blue · orange until M4 (F-19.1).
- Without F-19.6 (M2) the repository is picked in S-06 ("Pick a repository", folder dialog) and stored as the default repository. The S-01 Claude chip shows the real F-18.1 status; the rest of F-01.6 stays a placeholder until M2.
- Screens: S-06, S-07 (Claude).
- Demo: 100-file local change, stage half of one file by lines, Suggest, Commit, Push.

## M2 · GitLab connection and sources
**Goal:** pick any MR, commit or branch from S-01; MR diffs open in a worktree.
- Token setup (Credential Manager), GitLab client with Windows cert store, MR lists, source detection, `Ctrl+K`, MR fetch + worktree + diff, layer grouping, preparation progress/cancel, Open in Rider.
- Features: F-01 (all), F-02.1, F-02.2, F-02.3, F-02.4, F-03 (all), F-05.1, F-05.4, F-05.6, F-19.2, F-19.5, F-19.6, F-24.1, F-24.4, F-30.7. F-02.4 refreshes on focus and on a fixed timer here; it is wired to the poller in M10.
- Screens: S-01, S-07 (GitLab).
- Demo (stand-in GitLab): paste an MR link → worktree created → Browse files shows the MR diff; Open in Rider jumps to a line.
- **Field visit 2:** MR lists and filters, fetch, worktree and Open in Rider on real MRs (read-only); it first runs `field/RUNBOOK-1.md` (field visit 1, postponed from M0). **Postponed to field visit 3 by ADR-025:** M2 closes on the stand-in and M3 starts on the PC/Max results of S1–S3.

## M3 · Plan and Focus review
**Goal:** the core experience: plan, steps, notes, drafts (local), in Focus mode with all three layouts; self-review on local changes.
- Plan task + validation + coverage invariant + strategies + drag reorder; skim detection; step analysis task with prefetch; findings and decisions; ask with streaming and resume; sessions persisted and resumable.
- Features: F-02.5, F-04.1, F-04.3, F-05.5, F-06 (all), F-07 (all), F-09.1, F-09.2, F-09.3, F-09.4, F-09.5, F-09.6, F-10 (all), F-17.1, F-17.2, F-17.4.
- Screens: S-02, S-03 (A, B, C), S-01 resume cards, self-review summary (S-05 styling).
- Demo: review !<real MR> end to end in Focus, switch layouts mid-step, restart the app and continue.

## M4 · Detailed mode and keyboard
**Goal:** Detailed mode with rail, callouts, guide aside, footer; complete shortcut set.
- Features: F-08 (all), F-09.7, F-30.3, F-30.6, F-19.1, F-19.3.
- Screens: S-04, S-07 (General, Shortcuts).
- Demo: do a whole review with the keyboard only.

## M5 · Talking to GitLab: threads, publish, approve
**Goal:** finish a review in GitLab: threads inline, resolve/reply, publish drafts in one batch, approve separately.
- Draft notes with positions, bulk publish, partial failure handling, approval with SHA, discussions in the diff (incl. outdated).
- Features: F-11 (all), F-12 (all), F-13 (all), F-14 (all).
- Screens: S-05, thread cards in S-03/S-04.
- Demo (stand-in GitLab): publish 5 drafts (author gets one notification), resolve a thread, approve; show that approving published nothing.
- **Field visit 3** (after M5 or M6): first `field/RUNBOOK-1.md` and `field/RUNBOOK-2.md` (field visits 1 and 2, postponed by ADR-025), then publish, approve and resolve in the on-prem sandbox project.

## M6 · Pipelines
**Goal:** see and run the MR's pipeline and jobs from the app; understand failures.
- Features: F-20 (all).
- Screens: S-08; pipeline links everywhere.
- Demo (stand-in GitLab with a runner on the PC): run a new MR pipeline, play a manual job with a variable, retry a failed job, Explain failure → Add to drafts.
- Field visit 3 also covers pipelines and jobs in the on-prem sandbox project.

## M7 · Own code: fix, author mode, new MR
**Goal:** the author's side: answer feedback, fix with Claude or Rider, commit as fixup, push and reply; create MRs.
- Fix guard, fs watcher, queued replies, reply drafts, MR description task, reviewer suggestions (CODEOWNERS + blame + history), merge-tree check.
- Features: F-25 (all), F-26 (all), F-27 (all), F-17.3.
- Screens: S-10, S-11; Push and create MR in S-06.
- Demo (stand-in GitLab): on your MR, Fix with Claude → Accept → Commit (fixup) → Push and reply → thread resolved; create a new MR from a local branch.
- **Field visit 4a:** author mode on your own on-prem MR.

## M8 · Re-review and moved code
**Goal:** after a force-push, review only what changed; moved code doesn't look like new code.
- Versions, range-diff, replay via merge-tree, rebase noise, draft re-evaluation, moved-block detection and rows.
- Features: F-21 (all), F-22 (all), F-04.2.
- Screens: S-09, moved rows in S-03/S-04/S-12.
- Demo: fixture MR v2 → v3 with rebase; "3 changes to check"; outdated draft dropped; moved method shown as one row with "1 line changed".

## M9 · Code navigation
**Goal:** hover, definition, usages inside the diff.
- Spike S8 first (deferred from M0), at **field visit 4b** on the laptop with the real MAUI solution (timings and quality only, no code leaves the laptop). On the PC the client is developed against a public MAUI sample solution.
- LSP client (csharp-ls), tree-sitter fallback, MR membership, usages insight task, Settings › Integrations › Code navigation.
- Features: F-23 (all).
- Screens: S-12 behaviours in S-03/S-04, S-07 (Integrations, engine part).
- Demo: click `UploadPhotoAsync` → hover → Usages shows 2 callers outside the MR → Add as a question.

## M10 · Desktop integration and team rules
**Goal:** the app lives in the tray, links from Rider and toasts, and learns team rules.
- Tray icon + window, poller, toasts with protocol activation, deep links + single instance, External Tools installer, autostart, quiet hours, rule suggestions + MR to `.review/rules.md`.
- Features: F-28 (all), F-24.2, F-24.3, F-29 (all).
- Screens: S-13, S-07 (Integrations, Notifications, Team rules).
- Demo: a teammate requests your review → toast → Start review; Rider › Tools › Review this branch; dismiss the same kind of note 3 times → suggestion → MR.

## M11 · Hardening and release
**Goal:** ready for the team.
- Error and empty states from `02-screens.md` on every screen; offline mode; performance budgets measured; accessibility pass (keyboard, focus, contrast, reduced motion); installer (NSIS/MSI) with deep-link registration; code signing if available; short user guide in `docs/USER-GUIDE.md`.
- Features: NFR-01 … NFR-07 (final verification), manual checklist in `09-testing.md`.
- **Field visit 5** (M10 and M11): tray, toasts, deep links, Rider External Tools and the installer on the laptop; every `[field]` item in the `09` manual checklist.
- Demo: install on a clean teammate machine, review a real MR end to end.
