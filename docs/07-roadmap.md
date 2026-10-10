# 07 · Roadmap

Twelve milestones. Each one ends with a working app you can use and demo; nothing is built "for later" without a consumer. Work on one milestone per branch (`m3-plan-and-focus`), with the `/milestone` skill. A milestone is done when every acceptance criterion listed for it is ticked in `PROGRESS.md` with a commit SHA, `/verify` passes, `/design-check` was run for its screens, and `/audit` shows no gaps for it.

Dependencies: M0 → M1 → M2 → M3 → (M4, M5) → M6 → M7 → M8 → M9 → M10 → M11. M4 and M5 can swap.

---

## M0 · Foundations and spikes
**Goal:** the project skeleton exists, risky integrations are proven, and the shell looks like the mocks.
- Tauri 2 + React + TS strict + Vite; Rust workspace layout from `04-architecture.md`; lint/format/typecheck/test scripts (`npm run verify`).
- `tokens.css`, fonts via @fontsource, base styles; components: TitleBar (custom, draggable, caption buttons), Dock, Button, Tag, Square, Kbd, Segmented, Switch, ModelChip.
- Routes stubbed for S-01…S-11 with the shell; IPC client interface with **mock** and **tauri** implementations; `ts-rs` type generation.
- AppError, logging (tracing, rotation, redaction), settings store (SQLite + migrations), window state restore.
- Spikes S1–S9 from `08-decisions.md` with results written there. Adjust `05-integrations.md` if a spike disproves something (and say so in the PR).
- Features: F-30.1, F-30.2, F-30.4, F-30.5, NFR-08.
- Demo: app starts, dock switches between stub screens, Settings tile purple, `Ctrl+,` works; spike table filled.

## M1 · Local changes, diff renderer, commit
**Goal:** a useful daily tool even without GitLab: browse local changes and a commit, stage hunks/lines, commit with a Claude-suggested message.
- git runner, status/diff/log parsing, hunk IDs, intraline emphasis; virtualized file tree; DiffView (unified + split, Shiki worker, line numbers, hunk headers); staging patch builder; commit/amend/push.
- Claude runner (read-only profile), queue, commit-message task, Settings › Claude (needed for model/effort).
- Features: F-15 (all), F-16 (all), F-05.2, F-05.3, F-18 (all). Diff colors stay on the default blue · orange until M4 (F-19.1).
- Screens: S-06, S-07 (Claude).
- Demo: 100-file local change, stage half of one file by lines, Suggest, Commit, Push.

## M2 · GitLab connection and sources
**Goal:** pick any MR, commit or branch from S-01; MR diffs open in a worktree.
- Token setup (Credential Manager), GitLab client with Windows cert store, MR lists, source detection, `Ctrl+K`, MR fetch + worktree + diff, layer grouping, preparation progress/cancel, Open in Rider.
- Features: F-01 (all), F-02 (all), F-03 (all), F-05.1, F-05.4, F-05.6, F-19.2, F-24.1, F-24.4.
- Screens: S-01, S-07 (GitLab).
- Demo: paste an MR link → worktree created → Browse files shows the MR diff; Open in Rider jumps to a line.

## M3 · Plan and Focus review
**Goal:** the core experience: plan, steps, notes, drafts (local), in Focus mode with all three layouts; self-review on local changes.
- Plan task + validation + coverage invariant + strategies + drag reorder; skim detection; step analysis task with prefetch; findings and decisions; ask with streaming and resume; sessions persisted and resumable.
- Features: F-04.1, F-04.3, F-05.5, F-06 (all), F-07 (all), F-09 (all), F-10 (all), F-17.1, F-17.2.
- Screens: S-02, S-03 (A, B, C), S-01 resume cards.
- Demo: review !<real MR> end to end in Focus, switch layouts mid-step, restart the app and continue.

## M4 · Detailed mode and keyboard
**Goal:** Detailed mode with rail, callouts, guide aside, footer; complete shortcut set.
- Features: F-08 (all), F-30.3, F-30.6, F-19.1, F-19.3, F-19.4.
- Screens: S-04, S-07 (General, Shortcuts).
- Demo: do a whole review with the keyboard only.

## M5 · Talking to GitLab: threads, publish, approve
**Goal:** finish a review in GitLab: threads inline, resolve/reply, publish drafts in one batch, approve separately.
- Draft notes with positions, bulk publish, partial failure handling, approval with SHA, discussions in the diff (incl. outdated).
- Features: F-11 (all), F-12 (all), F-13 (all), F-14 (all).
- Screens: S-05, thread cards in S-03/S-04.
- Demo: publish 5 drafts (author gets one notification), resolve a thread, approve; show that approving published nothing.

## M6 · Pipelines
**Goal:** see and run the MR's pipeline and jobs from the app; understand failures.
- Features: F-20 (all).
- Screens: S-08; pipeline links everywhere.
- Demo: run a new MR pipeline, play a manual job with a variable, retry a failed job, Explain failure → Add to drafts.

## M7 · Own code: fix, author mode, new MR
**Goal:** the author's side: answer feedback, fix with Claude or Rider, commit as fixup, push and reply; create MRs.
- Fix guard, fs watcher, queued replies, reply drafts, MR description task, reviewer suggestions (CODEOWNERS + blame + history), merge-tree check.
- Features: F-25 (all), F-26 (all), F-27 (all), F-17.3.
- Screens: S-10, S-11; Push and create MR in S-06.
- Demo: on your MR, Fix with Claude → Accept → Commit (fixup) → Push and reply → thread resolved; create a new MR from a local branch.

## M8 · Re-review and moved code
**Goal:** after a force-push, review only what changed; moved code doesn't look like new code.
- Versions, range-diff, replay via merge-tree, rebase noise, draft re-evaluation, moved-block detection and rows.
- Features: F-21 (all), F-22 (all), F-04.2.
- Screens: S-09, moved rows in S-03/S-04/S-12.
- Demo: fixture MR v2 → v3 with rebase; "3 changes to check"; outdated draft dropped; moved method shown as one row with "1 line changed".

## M9 · Code navigation
**Goal:** hover, definition, usages inside the diff.
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
- Demo: install on a clean teammate machine, review a real MR end to end.
