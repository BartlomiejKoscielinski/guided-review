# 01 · Product specification

Guided Review is a Windows desktop app that walks a developer through a code change step by step: a teammate's GitLab merge request, a single commit, or their own local changes. Claude (through the developer's own Claude Code login) orders the change into steps, explains each one and points at what is worth a look. The developer decides everything; nothing reaches GitLab until they send it.

This file is the source of truth for **what** the app does. Every feature has an ID (`F-xx`) and every acceptance criterion has an ID (`F-xx.n`). The roadmap, `PROGRESS.md`, tests and commit messages refer to these IDs. Screens (`S-xx`) are specified in `02-screens.md`; the pixels are in `design/`.

## Users and context

- A small team building a .NET MAUI app, code on an on-prem GitLab, everyone on Windows with JetBrains Rider.
- The organization has Claude Code (Enterprise seats) and **no Anthropic API key**. The app therefore runs the `claude` CLI as a subprocess with each developer's own login (see `08-decisions.md`, ADR-002).
- Typical change size: 3 to 60 files. Local changes can reach 100+ files (mechanical refactors).

## Product principles

- **P-1 Calm by default.** Focus mode shows only what the current step needs. Detailed mode exists for people who want everything at once.
- **P-2 The human decides.** Claude proposes notes, comments, fixes and descriptions; the user accepts, edits or dismisses each one.
- **P-3 Nothing leaves the machine unless the user sends it.** Drafts stay local until Publish. Approve, publish, resolve and reply are separate actions.
- **P-4 Full coverage.** Every hunk belongs to exactly one step. The order can change, the scope can't.
- **P-5 Evidence over opinion.** Every Claude note names where it looked (`file:line`).
- **P-6 Keyboard first.** Every review action has a shortcut.
- **P-7 Fast.** Opening a reviewed MR again is instant (cache). Diff scrolling stays smooth at 10k lines.
- **P-8 Own code vs others' code.** Claude may edit files only in the user's own work (self-review, author mode), one file at a time, and the user accepts every edit. Never in a teammate's MR.

## Glossary

| Term | Meaning |
| - | - |
| Source | What is being reviewed: MR, commit (or range), local changes (uncommitted, staged, branch vs target). |
| Review session | Persistent state of one review of one source: plan, step progress, notes, drafts, layout. |
| Version | A GitLab MR diff version (one per push). Base, head and start SHA. |
| Worktree | A separate git worktree checked out at the reviewed head, so the user's own checkout is untouched. |
| Hunk | A diff hunk with a stable ID (see `04-architecture.md`). |
| Step | An ordered group of hunks with a title, a one-line purpose and "builds on" links. |
| Skim | Mechanical hunks (formatting, generated files, resx keys, csproj bumps) grouped out of the steps but still counted in coverage. |
| Note (finding) | A Claude observation on a line: severity, title, body, evidence, suggested comment. |
| Draft | A comment the user intends to publish. Local until Publish. |
| Thread | An existing GitLab discussion on the MR. |
| Self-review | Review of the user's own local changes. Never publishes anything. |
| Author mode | The user's own MR: answer threads, fix, push, reply. |

## Severity of notes

| Key | Label in UI | Color | Meaning |
| - | - | - | - |
| `fix` | Should fix | orange `#EF6E2E` | Likely bug or requirement gap |
| `q` | Question | blue `#3F7CF2` | Needs the author's answer |
| `nit` | Minor | grey `#8C8C87` | Style, naming, small cleanup |

---

## Feature catalog

### F-01 Start: input and source detection · S-01
- **F-01.1** One input accepts an MR URL (`https://<host>/<group>/<project>/-/merge_requests/<iid>`), `!<iid>`, a commit SHA (7–40 hex), a branch name, or a path to a local repository.
- **F-01.2** The detected type is shown as a label block next to the input before starting (e.g. `MERGE REQUEST !482`, `COMMIT a3f9c12`, `BRANCH chore/compiled-bindings`).
- **F-01.3** Enter or **Start** opens the source: MR → plan (S-02); commit → step review of that commit; branch or local path → self-review.
- **F-01.4** `Ctrl+K` opens S-01 with the input focused, from any screen.
- **F-01.5** Unknown or unreachable input shows an inline error under the input and stays on S-01: "No merge request !999 in mobile/mobile-app", "No commit, branch or repository matches “x”.", "x is not the configured GitLab server." (MR URL on another host), "mobile/x is not one of your repositories. Add it in Settings › GitLab." (MR URL of a project without a configured repository). An MR URL of another configured repository switches the active repository (F-30.7).
- **F-01.6** The title bar shows the repository switcher (name and path, F-30.7), "GitLab connected" with a green square, and "Claude Code signed in" as a chip with a purple square that opens Settings › Claude (on S-01 it takes the model chip's place); a failing check turns orange and offers the fixing action ("Add token", "Sign in to Claude Code").

### F-02 Start: merge request lists · S-01
- **F-02.1** Tabs **Waiting for me** (I am a reviewer and have not approved), **Mine** (I am the author), **All open** (project). Each tab shows a count.
- **F-02.2** A row shows: `!iid`, title, author · age, `+add −del · N files`, pipeline status (square + "pipeline passed/failed/running"), and an optional one-line note (e.g. "You're a reviewer · plan is ready", "Large: the plan splits it by layer", "2 unresolved threads from reviewers"). The note is the first that applies: unresolved threads ("1 unresolved thread from reviewers", "N unresolved threads from reviewers") > "Large: the plan splits it by layer" (40 files or more) > "You're a reviewer" (I'm a reviewer, any tab); F-02.5 adds " · plan is ready".
- **F-02.3** Clicking a teammate's MR opens the plan (S-02). Clicking my own MR opens author mode (S-10).
- **F-02.4** Lists refresh when S-01 gains focus and on the polling interval (F-28); the age of the data is visible when older than the interval ("Updated 7 min ago" in the Merge requests header).
- **F-02.5** If a plan for an MR is already cached for its current head, the row says "plan is ready".

### F-03 Start: commits and local changes · S-01
- **F-03.1** The Commits column lists commits of the current branch (branch name in the header), newest first, with SHA, subject, author · age. A search field filters by message, author or SHA.
- **F-03.2** Clicking selects one commit; Shift+click selects a range. Actions: **Review `<sha>`** (step review; a range shows **Review `<oldest>..<newest>`** and includes the oldest selected commit) and **Browse files** (S-06 in commit mode; disabled for a range).
- **F-03.3** The My changes column shows the current branch and three scopes as radio cards with counts: **Uncommitted changes**, **Staged only**, **Whole branch vs `<target>`**.
- **F-03.4** Actions: **Review before push** (self-review, F-17) and **Browse and commit** (S-06 local mode). The column states: "Self-review never publishes anything. You end with a list of fixes before pushing and a draft MR description."

### F-04 Resume sessions · S-01
- **F-04.1** "Pick up where you left off" lists unfinished sessions with progress ("5 of 9 steps · 3 drafts", "Self-review · 2 of 6 steps · saved yesterday 18:40").
- **F-04.2** If the MR head moved since the session started, the card shows an orange tag "N NEW COMMITS", a primary **Only new changes** (S-09) and a secondary **Continue**.
- **F-04.3** Session state (reviewed steps, note decisions, drafts, layout, scroll position per step, "For you to judge" ticks) survives app restarts.

### F-05 Preparation (deterministic, no AI)
- **F-05.1** For an MR, the app fetches `refs/merge-requests/<iid>/head` and creates (or reuses) a worktree at the head SHA in the review worktree folder. The user's own checkout is never modified.
- **F-05.2** The diff is computed between the MR's merge base and head with rename detection; binary files are listed but not rendered.
- **F-05.3** Every hunk gets a stable ID (same content → same ID across sessions).
- **F-05.4** Files are pre-grouped by MAUI layer from their path to help the plan and the "File order" strategy: Core, Infrastructure, App (ViewModels, services, app logic), XAML (views), Platforms, Tests, Resources, Build; anything else is Other. The plan and the UI tags use the same names.
- **F-05.5** Mechanical hunks are detected without AI where possible (whitespace-only, `.csproj` package bumps, `.resx` key additions, generated files) and proposed for Skim.
- **F-05.6** Preparation progress is visible ("Fetching", "Creating worktree", "Computing diff") and can be cancelled.
- **F-05.7** Changes without text hunks (rename-only, mode-only, binary, empty file added or deleted) get one file-level hunk with a stable ID, so every changed file belongs to exactly one step or skim group.

### F-06 Review plan · S-02
- **F-06.1** Header: MR title as the page heading, author · age, branch block (`source → target`), `N files +add −del · N commits`, pipeline status (links to S-08).
- **F-06.2** "What this change does": 2–4 sentences from Claude (purple square marks Claude content).
- **F-06.3** Plan · N steps: each row has a drag handle, number, title, layer tag, one-line reason ("Everything else builds on this."), `N files · +add −del` and a small add/delete bar.
- **F-06.4** Strategy toggle: **Contract to UI** (default), **Tests first**, **File order**. Switching reorders steps instantly without a new Claude call; the caption explains the strategy ("Contract to UI: start with what everything else builds on.").
- **F-06.5** Rows can be reordered by drag and drop; the custom order is saved in the session.
- **F-06.6** Skim row: "Skim: N mechanical files" with a short reason and **Show**.
- **F-06.7** Aside **Risks to check**: each risk with severity square and step references.
- **F-06.8** Aside **MR description vs code**: each claim from the description with ✓ found in step N, or ! missing/contradicted.
- **F-06.9** Aside **Already discussed**: existing threads summary; Claude does not repeat them and shows them in their step as context.
- **F-06.10** Aside **Coverage**: `N/N files · N/N hunks` with a bar. If Claude's plan misses hunks, the app adds them to an "Other" step automatically; the plan can never drop a hunk.
- **F-06.11** Actions: **Browse files instead** (S-06-like browse of the MR), **Start step 1** (Enter).
- **F-06.12** While steps are being analyzed, the title bar shows status ("Plan ready · Claude is analyzing step 1"). The plan is usable before step analyses finish.
- **F-06.13** If the change touches review or Claude configuration (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.mcp.json`, `.review/`), the app adds a risk at the top of Risks to check without AI: orange square, "This MR changes review or Claude configuration: <paths>". It is shown even when Claude isn't available.

### F-07 Step review: Focus mode and layouts · S-03
- **F-07.1** Three layouts switchable in the title bar and with `Ctrl+1/2/3`, sharing all state: **A Sidebar** (steps list left, with each step's short title), **B Minimal** (progress segments in title bar, floating toolbar at the bottom), **C Guide** (guide panel on the right).
- **F-07.2** Step header: "STEP 4 OF 8", title, a one- or two-sentence description; **Mark reviewed** (Space) and next.
- **F-07.3** File header: path, `+add −del`, number of notes in this file ("3 notes").
- **F-07.4** Split diff with old/new line numbers, intraline emphasis and syntax highlighting. Mechanical regions inside a step are collapsed to a fold row ("Fields and constructor: 3 new dependencies" · **Show**).
- **F-07.5** Gutter markers: in A and B a 12px square colored by severity; in C a numbered square. A thread icon marks lines with existing threads.
- **F-07.6** The focused note opens inline under its line (A, B) or in the guide panel (C). Card: severity tag, title, "Claude" label, body, **Add to drafts**, **Dismiss**, **More** (Edit and add, Ask Claude, Copy).
- **F-07.7** Layout C shows "Worth a look": numbered notes in line order, the focused one expanded; "+N minor" collapses minor notes; **Mark reviewed** (large) and "Ask Claude about this step…" input at the bottom.
- **F-07.8** Layout B's toolbar: previous, "Step 4 of 8", next, **Mark reviewed**, **Ask Claude**.
- **F-07.9** The chosen layout is remembered globally and per session.

### F-08 Step review: Detailed mode · S-04
- **F-08.1** Mode toggle Focus | Detailed in the title bar (`Ctrl+D`); both modes show the same session state.
- **F-08.2** Info header: branch block, author · age, `N files +add −del`, step progress segments with `done/total`, drafts count, pipeline status (links to S-08).
- **F-08.3** Rail: a first item "Change overview" (intent, risks, plan; links to S-02, done once the plan was opened), plan steps with state (done = green check, current = yellow, upcoming = number) and per-step draft count; Skim list; "Change coverage" with bar and the rule text.
- **F-08.4** Step header: "Step 4 / 8", "builds on" chips (click jumps to that step), previous, **Mark reviewed** (Space), **Next step** (`]`).
- **F-08.5** Sticky file bar: path, `+/−`, Split | Unified, Ignore whitespace, Open in Rider.
- **F-08.6** Full note callout: tag, title, Claude label, body, "Checked in" evidence chips, Suggested comment, **Add to drafts** (D), **Edit and add**, **Ask Claude**, **Dismiss** (X).
- **F-08.7** Guide aside: Code notes in line order (`N` cycles), "For you to judge" checklist with progress (`1/3`), Analysis context (files Claude read, each with its place: "step N", "outside MR" or "skim"; Claude's reason as a tooltip), Ask box with the current context ("step 4 · L46–L57") and `Ctrl+↵`.
- **F-08.8** Footer: shortcut hints (J K hunk, [ ] step, N note, C comment, A ask, Space reviewed, ? all) and Claude status ("Claude: steps 5–6 ready, analyzing 7", "worktree @ a3f9c12").
- **F-08.9** End-of-step card: "End of step 4", next step title with stats, **Next step**.

### F-09 Claude notes (findings)
- **F-09.1** Each note has severity, title, body, line (file, side, line), evidence (`file:line` list) and a suggested comment.
- **F-09.2** Decisions: **Add to drafts** (creates a draft from the suggested comment), **Edit and add** (opens the text for editing first), **Dismiss**. Each decision can be undone.
- **F-09.3** After Add to drafts the card says "Added to drafts. It reaches GitLab only when you publish." After Dismiss: "Dismissed. Claude won't raise it again for this commit."
- **F-09.4** Dismissed notes are fingerprinted (rule = the note's `kind` + file + normalized code: the line with whitespace collapsed plus one line of context on each side) and not raised again for the same head; dismissals also feed F-29.
- **F-09.5** Notes never duplicate existing GitLab threads on the same line and topic (Claude gets the thread list as context).
- **F-09.6** Notes appear progressively: steps are analyzed in the background, the next step is pre-fetched while the user reads the current one.
- **F-09.7** `C` (or the comment action on a selected line) opens an inline composer under the line in the note-card style: text area, **Add to drafts** (`Ctrl+↵`), **Cancel** (Esc). It creates a draft with the line's position.

### F-10 Ask Claude
- **F-10.1** Questions are asked in the context of the current step and, if any, the selected lines.
- **F-10.2** Answers stream in. Follow-up questions continue the same Claude session (`--resume`).
- **F-10.3** An answer can be turned into a draft comment with one click.

### F-11 Existing GitLab threads in the diff
- **F-11.1** Threads on lines in the current step show inline (avatars, author · age, text, replies).
- **F-11.2** Actions: **Resolve** (green), **Reply**, **Reopen** on resolved threads. Resolve/unresolve are sent immediately and are independent from drafts and approval.
- **F-11.3** Threads on outdated lines (from an older version) are shown on the closest matching line (same line text within ±20 lines, mapped through the interdiff) with an "outdated" tag; without a match they show on the file header.

### F-12 Summary: drafts and publishing · S-05
- **F-12.1** "SUMMARY" with "All N steps reviewed." (or "N of M steps reviewed.") and **Back to steps**.
- **F-12.2** Tabs **Drafts N** and **Threads N open**.
- **F-12.3** Drafts list: checkbox (include in publish), severity square, text, `file:line`, edit pencil. Note "Only you can see drafts until you publish them."
- **F-12.4** "Add a summary comment" checkbox reveals a text area prefilled by Claude with a short overall summary.
- **F-12.5** **Publish (N)** publishes the selected drafts (and summary comment) in one batch so the author gets a single notification; afterwards a blue banner "Published N comments. The author got a single notification." and each item is marked "published".
- **F-12.6** Publishing never approves the MR.
- **F-12.7** Drafts belong to the MR (project + iid). Drafts added outside a review (Explain failure on S-08, Add as a question on S-12) join the latest session of that MR or create a "drafts only" session that S-05 opens.

### F-13 Summary: threads · S-05
- **F-13.1** Filters All / Open N / Resolved N.
- **F-13.2** Each thread: first message, author · replies · `file:line`, **Resolve** or **Reopen**.
- **F-13.3** Claude hint chip when the thread looks addressed by a later commit ("Claude: index added in a91f2c0").

### F-14 Approval · S-05
- **F-14.1** Approval tile: state ("NOT APPROVED YET" with dashed square / approved in solid green), "Approvals: X of Y".
- **F-14.2** **Approve MR** / **Revoke approval**. Approval is sent with the head SHA that was reviewed; if the MR changed meanwhile the app says so and offers S-09.
- **F-14.3** The tile states "Approving doesn't publish comments." and the number of open threads ("Open threads: 3." or "All threads resolved."). Once approved with unpublished drafts it says "Approved without comments. Your drafts are waiting, publish them whenever you like."

### F-15 Changes browser · S-06
- **F-15.1** Source toggle **Local changes** / **Commit `<sha>`**.
- **F-15.2** File tree grouped by directory (collapsible, with counts), thin rows (≤ 26px), virtualized, works smoothly with 1000 files.
- **F-15.3** Filter input with match count.
- **F-15.4** Status tags as words, not letters: **NEW** (green), **DELETED** (orange, name struck through), **RENAMED** (blue, tooltip with the old path). Modified files have no tag. Each row shows `+add −del`.
- **F-15.5** Diff view Unified | Split, Open in Rider.
- **F-15.6** Commit mode shows the commit's files and a details panel: SHA, subject, body, author · age, parent, **Review step by step**.

### F-16 Staging and commit · S-06
- **F-16.1** Checkboxes on directories (tri-state), files and hunks ("In commit · lines 22–25"); Shift+click on line numbers picks single lines.
- **F-16.2** Checkbox state **is** the git index: changes made here are visible in Rider and vice versa (refresh on file-system change).
- **F-16.3** Master checkbox with "80 of 100 in commit" and collapse-all.
- **F-16.4** Commit panel: message text area, **Suggest** (Claude writes a message from the staged diff), summary line counter `n/72`, **Amend previous commit**, **Commit · N files** (disabled without a message or staged changes), link "Review with Claude first".
- **F-16.5** After commit: green block "Created `<sha>`" with **Push and create MR** (→ S-11), **Push only**, **New commit**.

### F-17 Self-review (local changes)
- **F-17.1** Same plan and step flow as an MR, on the selected local scope; worktree is not needed (reads the working tree).
- **F-17.2** No publish, approve or thread actions are shown. Notes can be turned into a "fix list" and into Fix with Claude (F-25).
- **F-17.3** At the end it offers a draft MR description (F-27.2) and **Browse and commit**.
- **F-17.4** The self-review summary reuses the S-05 drafts list styling without publish, approve or threads: notes kept "to fix" (with Fix with Claude per item once F-25 exists) and **Copy as checklist**.

### F-18 Settings: Claude · S-07
- **F-18.1** Status "Claude Code: signed in" (from `claude auth status`, the startup probe and the last task result, `05` › Startup checks), or an action to sign in.
- **F-18.2** Defaults: Model (Same as Claude Code, Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1), Effort (low, medium, high, xhigh, max; default medium), "Writes in" (English, Polish) for notes, suggested comments, commit messages and descriptions.
- **F-18.3** Per task overrides (model + effort): Review plan, Step analysis, Questions, Fixes on your code, MR description and pipeline, Commit message. Defaults: plan opus/high, step sonnet/medium, questions default/low, fixes sonnet/medium, MR & pipeline sonnet/low, commit haiku/low.
- **F-18.4** Effort levels not supported by the chosen model are disabled with a tooltip ("<Model> doesn't support <effort>.").
- **F-18.5** The model chip in the title bar shows the model · effort of the task relevant to the screen and opens this section.
- **F-18.6** The section shows the Claude Code executable the app uses (path and version, **Change**) and "Run at most N Claude tasks at once" (1–4, default 2).
- **F-18.7** When Claude reports a usage limit, background analysis pauses and the UI says "Claude usage limit reached" (with the reset time when Claude gives one); nothing is lost and the task can be retried later.

### F-19 Settings: General, GitLab, Shortcuts · S-07
- **F-19.1** General: Start in (Focus/Detailed), Focus layout (A/B/C), Diff colors (Blue · orange / Green · red), Start with Windows (default off).
- **F-19.2** GitLab: server URL, signed-in user, personal access token (masked, scope `api`, expiry date), stored in Windows Credential Manager; list of repositories with local paths, review worktree folder per repository, default repository.
- **F-19.3** Shortcuts: list of all shortcuts in F-30.6, grouped (Review, Code, App).
- **F-19.5** Token setup: without a token, Server URL and a masked token input with **Check and save** (the app checks the user, scope and expiry, then stores it); with a token, **Replace token** and **Remove**. The UI only ever sees the token masked as prefix + last 4 characters (`glpat-…3f9a`), computed in the core.
- **F-19.6** Repositories: **Add repository** (folder dialog; the GitLab project is detected from the `origin` remote), **Set as default**, **Remove**, and the review worktree folder per repository (default `<repo parent>\.review`).
- **F-19.4** Settings opens with `Ctrl+,` and from the always-visible purple Settings tile in the dock.

### F-20 Pipelines · S-08
- **F-20.1** Shows the MR's pipelines as tabs (newest first, "version N · latest"), the selected pipeline's status block (Passed / Failed / Running / Canceled), "N allowed failure" tag, number, type ("Merge request pipeline"), SHA, version, author · age · duration.
- **F-20.2** Stages as columns with job rows: status square (passed ✓, failed ✕, failed-allowed !, running spinner, waiting, manual ▶, canceled, skipped), job name, duration or state, one action button (Retry / Run / Cancel). Retry and Cancel act at once; a manual job's Run only selects the job and opens its form (F-20.6).
- **F-20.3** **Run new pipeline** asks for confirmation ("Run a new merge request pipeline on `<sha>`? Uses the MR's latest commit. Manual jobs stay manual.") and then shows the new pipeline live.
- **F-20.4** **Retry failed jobs** (pipeline), **Cancel pipeline** (while running), **Open in GitLab**.
- **F-20.5** Selecting a job shows details: name, status, stage, duration, Retry/Cancel, Full log; the log tail with colored command, pass and error lines; streaming while running.
- **F-20.6** Manual jobs show their description (when GitLab provides one) and editable variables ("Variables for this run", "+ Add variable"; empty at first, then the last values used for that job name on this machine) and **Run `<job>`**; "Runs on `<sha>` as you." Only **Run `<job>`** plays the job.
- **F-20.7** Failed jobs offer **Explain failure**: Claude reads the log and the MR diff and returns a verdict (Caused by this MR / Already fixed in version N / Unrelated / Flaky / Unknown), title, explanation, evidence chips and, if relevant, a suggested comment with **Add to drafts**.
- **F-20.8** Successful jobs list artifacts with **Download**.
- **F-20.9** A retry that fails the same way says "Retried: failed again on the same test."
- **F-20.10** Pipeline status everywhere (S-01 rows, S-02 meta, S-04 header, S-10 title bar) links to S-08.

### F-21 Re-review after rebase or force-push · S-09
- **F-21.1** Opened from "Only new changes" (S-01), a tray notification, or when an open session detects a newer MR version.
- **F-21.2** Heading "N CHANGES TO CHECK" with "<author> force-pushed <age> and rebased onto <target>." and a primary **Review N changes** (Enter) plus **Review everything again**.
- **F-21.3** Compare control: from version (v1, v2 … with a "you" marker on the version last reviewed) → latest.
- **F-21.4** Commits list from `git range-diff` with word tags: **Same** (patch identical after rebase), **Changed** (N hunks changed), **New**, **Dropped** (struck through).
- **F-21.5** Rebase noise: "Rebase brought N commits from <target>. Hidden: they aren't part of this MR." with Show/Hide.
- **F-21.6** Selecting a commit shows Claude's one-paragraph summary of what changed and a split diff "Version 2 · your review" vs "Version 3 · now" limited to that commit's changes. Same and Dropped commits show a one-line explanation instead.
- **F-21.7** "Your review so far": steps still valid / steps to look at again; drafts on changed code with Claude's verdict ("fixed in v3 …") and **Drop draft** / **Keep** (Undo).
- **F-21.8** Only changed commits become steps; unchanged steps keep their reviewed state.

### F-22 Moved code
- **F-22.1** Blocks moved between or within files are detected and collapsed to one row: "MOVED · 16 lines from `<file>` L88–103" with **Show** / **Hide** and **Go to origin**.
- **F-22.2** Small edits inside a moved block are shown ("1 LINE CHANGED" tag) and, when expanded, unchanged moved lines are dimmed and changed lines shown as a normal −/+ pair.
- **F-22.3** The origin side of a move shows "Moved to `<file>` L44–59" instead of a full deletion.

### F-23 Code navigation in the diff · S-12
- **F-23.1** Symbols in the diff are clickable (dotted underline). Clicking shows a hover card above the line: kind tag (method, interface, class…), location (`Services/IPhotoApi.cs:5`), signature, documentation summary, "Added in this MR · step 1" when relevant, and actions **Definition** (F12), **Usages N** (Shift+F12), **Open in Rider**.
- **F-23.2** **Definition** opens an inline peek panel under the line with the definition's code, a tag "In this MR" / "Not changed in this MR", and Close (Esc).
- **F-23.3** **Usages** opens a side panel grouped **In this MR** (with step) and **Outside this MR** (marked "not changed"). Each usage links to its place.
- **F-23.4** When usages outside the MR may be affected, Claude adds a short insight with **Add as a question** (creates a draft).
- **F-23.5** File bar shows index status ("Code index ready · csharp-ls"); without an index the app falls back to a symbol index (tree-sitter) and says that usages are matched by name.

### F-24 Rider integration (both ways)
- **F-24.1** **Open in Rider** opens the file at the line (`rider64.exe --line N <file>`). Files of a teammate's MR open from the review worktree by default (setting).
- **F-24.2** The app registers the `guidedreview://` protocol; `guidedreview://mr/<iid>[?project=<path>]` opens the MR plan (default repository when `project` is missing), `guidedreview://commit/<sha>` and `guidedreview://branch/<name>?repo=<path>` open those sources. A running instance receives the link (single instance).
- **F-24.3** Settings › Integrations › **Add to Rider** creates External Tools "Review this branch" and "Review this commit" (program `GuidedReview.exe`, arguments using `$ProjectFileDir$`).
- **F-24.4** Rider path is detected automatically and can be changed.

### F-25 Fix with Claude (own code only)
- **F-25.1** Available in self-review notes and author-mode threads. Never offered on a teammate's MR.
- **F-25.2** Claude works in an app-managed scratch copy of the working tree, never in the user's working copy, and may edit only the one file the note or thread points at. After the run the app verifies that no other file changed; otherwise it discards the run and reports it.
- **F-25.3** The proposal shows as a diff card "Proposed change · Edited 1 file: <name>" with a one-sentence explanation, **Accept** (green) and **Discard**.
- **F-25.4** Accept writes the change into the working copy (unstaged) only if the file is unchanged since the run started; otherwise it says "The file changed while Claude worked. Run it again." Discard drops the proposal; the working copy was never touched.

### F-26 Author mode · S-10
- **F-26.1** Title bar shows "You're the author" (blue) and pipeline status. Left panel: "FEEDBACK ON YOUR MR", "N THREADS TO ANSWER", branch, thread list with avatar, author, `file:line`, two-line excerpt and a status tag (Change requested, Question, Fix proposed, Fixed locally · not pushed, Replied, Answered, Resolved); "1 resolved earlier" summary; a note "Fixes stay on your branch…".
- **F-26.2** The selected thread opens in the code at its line with the conversation and actions **Fix with Claude**, **Fix in Rider**, **Reply**.
- **F-26.3** **Fix in Rider** opens the file at the line and watches the working tree; a detected change continues the flow ("Change detected from Rider. Commit it below.").
- **F-26.4** After a fix: commit panel with a suggested message, "As a fixup of `<sha>` "<subject>"" (default on) with the note "Marked as a fixup of `<sha>`. Fold it in with git rebase --autosquash before merging, or merge with Squash commits." (off: "Stays a separate commit."), **Commit**.
- **F-26.5** After commit: "Committed `<sha>` · not pushed yet", the reply to be sent ("Fixed in `<sha>`. <one sentence>."), "Resolve the thread" (default on), **Push and reply**. The reply is queued and sent only after a successful push.
- **F-26.6** After push: "Pushed · Replied to <name> and resolved the thread." and a link to the new pipeline.
- **F-26.7** Question threads: reply text area, **Draft with Claude** (fills a proposed answer), **Send reply** (immediate). After sending: "Answered. The thread stays open until <reviewer> resolves it."
- **F-26.8** If the user's checkout isn't on the MR's source branch, author mode is read-only with "Check out <branch> to fix here. The app never switches your branch." and **Open in Rider**; Fix, Commit and Push are hidden.

### F-27 Create merge request · S-11
- **F-27.1** Opened from "Push and create MR" (S-06), self-review end, or Rider. Branch block `source → target` (target selectable), `N commits · N files · +/−`.
- **F-27.2** Title and description prefilled by Claude from commits and diff; description sections **What**, **Why**, **How to test** (numbered); **Shorter version** / **Longer version** regenerate.
- **F-27.3** Reviewers suggested with reasons: code owner (CODEOWNERS), "Wrote N% of the changed lines" (git blame), "Reviewed N MRs in <area> this month"; **Add/Added** toggles; free search to add others.
- **F-27.4** Options: Mark as draft, Delete branch after merge (default on), Squash commits.
- **F-27.5** Before you create: Branch pushed, No conflicts with `<target>` (local `git merge-tree`), Self-review done; failures are orange with details (e.g. "Conflicts with main · 2 files: …").
- **F-27.6** **Create merge request** / **Create draft MR**; note who gets notified. Success screen: "!483" big green block, pipeline link, reviewers notified, **Go to your MR**, **Copy link**, **Open in GitLab**.

### F-28 Tray and notifications · S-13
- **F-28.1** The app keeps a tray icon (yellow mark with an orange count badge; grey when paused). Closing the window keeps it in the tray (Settings › General › "Keep running in the tray when closed", default on).
- **F-28.2** Polling GitLab every N minutes (1, 3, 5, 10, 15; default 3) for: review requests, new commits on MRs I reviewed (incl. force-push), comments on my MRs, pipeline results on my MRs, approvals on my MRs (off by default). Each type can be switched off.
- **F-28.3** Windows toast per event with title, body and two buttons (e.g. **Start review** / **Later**, **Re-review** / **Later**). Later snoozes for 30 minutes.
- **F-28.4** Tray menu: "GUIDED REVIEW", "Checked 1 min ago", settings shortcut; groups Waiting for you, Changed since your review, Your MRs; each row opens the right screen; **Open app**, **Pause 1 h** / **Resume** ("Paused until 15:32").
- **F-28.5** Quiet hours (default 18:00–08:00 and weekends; from, to and weekends editable) suppress toasts but keep the badge.

### F-29 Team rules learning · S-07 › Team rules
- **F-29.1** Claude reads `.review/rules.md` before every plan and step analysis, taken from the **target branch** (`git show <base>:.review/rules.md`), so an MR cannot change the rules it is reviewed with.
- **F-29.2** When the user dismisses notes of the same kind N times (default 3) across MRs, the app shows a suggested rule with evidence ("You dismissed '…' 4 times in 3 weeks, every time inside `#if DEBUG`.", MR chips) and the proposed line as a `+` diff.
- **F-29.3** Actions: **Propose in an MR** (creates a branch and an MR changing `.review/rules.md`, reviewer = code owner), **Edit**, **Not now**, **Don't suggest this** (with Undo).
- **F-29.4** The rule takes effect only after that MR is merged. The section lists the current rules with author and MR, and "Open in Rider".
- **F-29.5** Dismissal statistics stay on the user's machine.

### F-30 App shell, navigation and keyboard
- **F-30.1** Custom title bar (44px): logo, repository, context (e.g. `!482` + title), screen-specific controls (mode toggle, layout switcher, status, model chip, primary action such as **Finish review**), Windows caption buttons; the bar is draggable and a double-click maximizes.
- **F-30.2** Dock (72px) with tiles **MRs** (blue when active), **Review** (yellow), **Changes** (green), and **Settings** (always purple, at the bottom; white outline when active). Review opens the most recent unfinished session at its last screen; without one it is dimmed with the tooltip "No review open. Pick one in MRs."
- **F-30.3** **Finish review** (review screens) opens S-05.
- **F-30.4** Window size, position, maximized state and last screen are restored on start. The last screen is restored only if its session still exists (otherwise S-01), and restoring never starts Claude or GitLab work. First start: 1600×1000 fitted to the work area; minimum 1280×800, or the work area when it is smaller (e.g. 1920×1080 at 150%); off-screen positions are pulled back onto a monitor (the title bar must be reachable).
- **F-30.5** All UI text is English. Claude output language follows F-18.2.
- **F-30.6** Shortcuts: `]` next step, `[` previous step, `Space` mark reviewed, `J`/`K` next/previous hunk, `N` next note, `D` add to drafts, `X` dismiss, `C` comment on line, `A` ask, `F12` definition, `Shift+F12` usages, `Ctrl+Shift+O` open in Rider, `Ctrl+K` open anything, `Ctrl+,` settings, `Ctrl+D` Focus/Detailed, `Ctrl+1/2/3` layouts, `Enter` primary action on S-02/S-09, `Esc` close popovers, `?` all shortcuts (opens Settings › Shortcuts).
- **F-30.7** The repository switcher in the title bar lists the configured repositories and "Add repository…" (folder dialog); switching changes the active repository of S-01 and S-06. On review screens it shows the session's repository as plain text.

---

## Non-functional requirements

- **NFR-01 Performance.** Cold start to interactive S-01 < 1.5 s. Reopening a cached MR session < 300 ms to first diff paint. Diff scrolling 60 fps for files up to 10,000 lines (virtualized). File tree of 1,000 files renders < 100 ms. Syntax highlighting never blocks the UI thread.
- **NFR-02 Responsiveness.** Every long operation (git fetch, Claude task, GitLab call) is async, shows progress and can be cancelled. The UI never freezes.
- **NFR-03 Reliability.** Claude or GitLab failures never lose user work (drafts, decisions, commit messages). Failed publish keeps unpublished drafts. Retries with backoff for transient GitLab errors; respect `Retry-After` on 429.
- **NFR-04 Security.** See `06-security.md`. Highlights: token in Windows Credential Manager, Claude read-only on others' code, no project hooks or MCP from reviewed repos, repository content treated as untrusted input.
- **NFR-05 Offline.** Without network the app opens cached sessions read-only and says so; local self-review and commit keep working.
- **NFR-06 Accessibility.** Keyboard reachable everything, visible focus (2px yellow outline), ARIA roles on tabs/radios/switches, text contrast ≥ 4.5:1 for body text, `prefers-reduced-motion` respected.
- **NFR-07 Platform.** Windows 10 22H2+ and Windows 11, x64. Code should stay portable (macOS/Linux later), so no Windows-only API without an abstraction.
- **NFR-08 Privacy.** No telemetry. Logs are local, info level by default, rotate at 10 MB and keep 5 files, and never contain tokens (`glpat-`, `gloas-`, `glptt-`, `glrt-` and the other GitLab token prefixes, `PRIVATE-TOKEN` and `Authorization` values and credentials in URLs are redacted, `06` › T4), prompts, Claude output, diffs or file contents.
