# Progress

Single source of truth for what is done. One line per acceptance criterion from `01-product.md` (and NFRs), grouped by milestone (`07-roadmap.md`).

Rules for Claude Code:
- Tick an item only when it is implemented **and** covered by a test or a manual check named in `09-testing.md`. Append the commit SHA: `- [x] F-06.4 … (a1b2c3d)`.
- Partially done: leave unticked and add `— partial: <what is missing>`.
- Never delete lines. If the spec changes, update `01-product.md` first, then this file.
- At the end of every session, update this file and the "Session log" at the bottom.
- Items that can only be proven in the real environment (on-prem GitLab, Claude Enterprise, team machines) are ticked after layers 1–2 pass and get a `[field]` line in the `09-testing.md` manual checklist. If a field visit fails, untick and add `— partial: field <visit>: <what failed>`.

## M0 · Foundations and spikes
- [x] F-19.4 Settings opens with Ctrl+, and from the always-visible purple Settings tile in the dock. (a9369b0)
- [x] F-30.1 Custom title bar (44px): logo, repository, context (e.g. !482 + title), screen-specific controls (mode… (a9369b0, 6494c5f)
- [x] F-30.2 Dock (72px) with tiles MRs (blue when active), Review (yellow), Changes (green), and Settings (always… (a9369b0)
- [x] F-30.4 Window size, position, maximized state and last screen are restored on start. The last screen is restored… (08a1a15)
- [x] NFR-08 Privacy: No telemetry. Logs are local, info level by default, rotate at 10 MB and keep 5 files, and never… (771f616)

## M1 · Local changes, diff renderer, commit
- [x] F-05.2 The diff is computed between the MR's merge base and head with rename detection; binary files are listed… (1b1b7e1)
- [x] F-05.3 Every hunk gets a stable ID (same content → same ID across sessions). (1b1b7e1)
- [x] F-05.7 Changes without text hunks (rename-only, mode-only, binary, empty file added or deleted) get one… (1b1b7e1)
- [x] F-15.1 Source toggle Local changes / Commit <sha>. (f463581, eae1bd6)
- [x] F-15.2 File tree grouped by directory (collapsible, with counts), thin rows (≤ 26px), virtualized, works smoothly… (e936668, eae1bd6)
- [x] F-15.3 Filter input with match count. (eae1bd6)
- [x] F-15.4 Status tags as words, not letters: NEW (green), DELETED (orange, name struck through), RENAMED (blue… (eae1bd6)
- [x] F-15.5 Diff view Unified | Split, Open in Rider. (e936668, eae1bd6)
- [x] F-15.6 Commit mode shows the commit's files and a details panel: SHA, subject, body, author · age, parent, Review… (598c1a0, eae1bd6)
- [x] F-16.1 Checkboxes on directories (tri-state), files and hunks ("In commit · lines 22–25"); Shift+click on line… (598c1a0, eae1bd6)
- [x] F-16.2 Checkbox state is the git index: changes made here are visible in Rider and vice versa (refresh on… (598c1a0, 1e4f54e)
- [x] F-16.3 Master checkbox with "80 of 100 in commit" and collapse-all. (eae1bd6)
- [x] F-16.4 Commit panel: message text area, Suggest (Claude writes a message from the staged diff), summary line… (598c1a0, 65a9c8d, a75c08a)
- [x] F-16.5 After commit: green block "Created <sha>" with Push and create MR (→ S-11), Push only, New commit. (598c1a0, eae1bd6)
- [x] F-18.1 Status "Claude Code: signed in" (from claude auth status, the startup probe and the last task result), or an action to sign in. (65a9c8d, a75c08a)
- [x] F-18.2 Defaults: Model (Same as Claude Code, Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1), Effort (low, medium… (a75c08a)
- [x] F-18.3 Per task overrides (model + effort): Review plan, Step analysis, Questions, Fixes on your code, MR… (65a9c8d, a75c08a)
- [x] F-18.4 Effort levels not supported by the chosen model are disabled with a tooltip ("<Model> doesn't support… (a75c08a)
- [x] F-18.5 The model chip in the title bar shows the model · effort of the task relevant to the screen and opens this… (a75c08a)
- [x] F-18.6 The section shows the Claude Code executable the app uses (path and version, Change) and "Run at most N… (65a9c8d, a75c08a)
- [x] F-18.7 When Claude reports a usage limit, background analysis pauses and the UI says "Claude usage limit reached"… (65a9c8d, a75c08a)
- [x] F-30.5 All UI text is English. Claude output language follows F-18.2. (65a9c8d)

## M2 · GitLab connection and sources
- [x] F-01.1 One input accepts an MR URL (https://<host>/<group>/<project>/-/merge_requests/<iid>), !<iid>, a commit… (79b3e9f, f7fc763, 24d4aac)
- [x] F-01.2 The detected type is shown as a label block next to the input before starting (e.g. MERGE REQUEST !482… (24d4aac, 408f105, e69fc9c)
- [x] F-01.3 Enter or Start opens the source: MR → plan (S-02); commit → step review of that commit; branch or local… (79b3e9f, f7fc763, 989c500, 24d4aac, e69fc9c)
- [x] F-01.4 Ctrl+K opens S-01 with the input focused, from any screen. (24d4aac, e69fc9c)
- [x] F-01.5 Unknown or unreachable input shows an inline error under the input and stays on S-01 (e.g. "No merge… (d889431, 79b3e9f, 989c500, 24d4aac, e69fc9c)
- [x] F-01.6 The title bar shows the repository switcher (name and path, F-30.7), "GitLab connected" with a green… (461d39a, 3dd3f20, c75b86a, e69fc9c)
- [x] F-02.1 Tabs Waiting for me (I am a reviewer and have not approved), Mine (I am the author), All open (project).… (2a43de4, 3dd3f20, 24d4aac, e69fc9c)
- [x] F-02.2 A row shows: !iid, title, author · age, +add −del · N files, pipeline status (square + "pipeline… (2a43de4, 24d4aac, 408f105)
- [x] F-02.3 Clicking a teammate's MR opens the plan (S-02). Clicking my own MR opens author mode (S-10). (24d4aac, e69fc9c)
- [x] F-02.4 Lists refresh when S-01 gains focus and on the polling interval (F-28); the age of the data is visible… (05312ff)
- [x] F-03.1 The Commits column lists commits of the current branch (branch name in the header), newest first, with… (79b3e9f, f7fc763, 4822220, 8d8e0df, 1b18c64)
- [x] F-03.2 Clicking selects one commit; Shift+click selects a range. Actions: Review <sha> (step review) and Browse… (87c3e9e, 4822220, 8d8e0df)
- [x] F-03.3 The My changes column shows the current branch and three scopes as radio cards with counts: Uncommitted… (79b3e9f, f7fc763, 4822220, 8d8e0df)
- [x] F-03.4 Actions: Review before push (self-review, F-17) and Browse and commit (S-06 local mode). The column… (4822220, 8d8e0df)
- [x] F-05.1 For an MR, the app fetches refs/merge-requests/<iid>/head and creates (or reuses) a worktree at the head… (1103afb)
- [x] F-05.4 Files are pre-grouped by MAUI layer from their path to help the plan and the "File order" strategy: Core… (c0c949e)
- [x] F-05.6 Preparation progress is visible ("Fetching", "Creating worktree", "Computing diff") and can be cancelled. (1103afb, 989c500, 113b0f9, 1e2efda, 7d311ac)
- [x] F-19.2 GitLab: server URL, signed-in user, personal access token (masked, scope api, expiry date), stored in… (461d39a, 2ec1605, c9d56ed)
- [x] F-19.5 Token setup: without a token, Server URL and a masked token input with Check and save (the app checks the… (461d39a, 3dd3f20, 2ec1605)
- [x] F-19.6 Repositories: Add repository (folder dialog; the GitLab project is detected from the origin remote), Set… (79b3e9f, f7fc763, 2ec1605)
- [x] F-24.1 Open in Rider opens the file at the line (rider64.exe --line N <file>). Files of a teammate's MR open from… — native Windows path fixed after the real-app smoke on the PC (eed211f); the `[field]` check in 09 stays for the next visit (400c935, 7deb140, 989c500, 3460aab, 7726271, 7d311ac, eed211f)
- [x] F-24.4 Rider path is detected automatically and can be changed. (400c935, 4ca0685, 2ec1605)
- [x] F-30.7 The repository switcher in the title bar lists the configured repositories and "Add repository…" (folder… (79b3e9f, f7fc763, c75b86a, e69fc9c, d13a0b0)

## M3 · Plan and Focus review
- [x] F-02.5 If a plan for an MR is already cached for its current head, the row says "plan is ready". (b0092de, 5cfcb59, e207a9b, cd12450, 1c706e3)
- [x] F-04.1 "Pick up where you left off" lists unfinished sessions with progress ("5 of 9 steps · 3 drafts"… (a9ff402, 97a6400, 6cbb9ec, d53eb9a, 27e4848)
- [x] F-04.3 Session state (reviewed steps, note decisions, drafts, layout, scroll position per step, "For you to… (4a20f66, 99de98a, f53e296, 0007519, 4c52a2d, 01ba969, e0a3616)
- [x] F-05.5 Mechanical hunks are detected without AI where possible (whitespace-only, .csproj package bumps, .resx key… (bd8d436, 355331f, 2575c46, 451a89a)
- [x] F-06.1 Header: MR title as the page heading, author · age, branch block (source → target), N files +add −del · N… (95ba9b0)
- [x] F-06.2 "What this change does": 2–4 sentences from Claude (purple square marks Claude content). (355331f, 7da45d0, 79e1527, e0e5604, 95ba9b0, 5b58621)
- [x] F-06.3 Plan · N steps: each row has a drag handle, number, title, layer tag, one-line reason ("Everything else… (df6afea, 355331f, 597f166, e0e5604, 95ba9b0)
- [x] F-06.4 Strategy toggle: Contract to UI (default), Tests first, File order. Switching reorders steps instantly… (bc15516, 7aa235d, 79e1527, 95ba9b0, 7367e08, 81423f9, 33e24d6)
- [x] F-06.5 Rows can be reordered by drag and drop; the custom order is saved in the session. (7da45d0, 79e1527, 7aa235d, 95ba9b0, 7367e08, 7e0176f, 4700e72, 2909095)
- [x] F-06.6 Skim row: "Skim: N mechanical files" with a short reason and Show. (597f166, bb292cd, 95ba9b0, 5db5191, 020312b, b96e261)
- [x] F-06.7 Aside Risks to check: each risk with severity square and step references. (95ba9b0)
- [x] F-06.8 Aside MR description vs code: each claim from the description with ✓ found in step N, or !… (7da45d0, 95ba9b0)
- [x] F-06.9 Aside Already discussed: existing threads summary; Claude does not repeat them and shows them in their… (10aa2f0, 355331f, 95ba9b0, 9748265, 530d516, 81423f9, 47742bc, f604e59, d6383ce)
- [x] F-06.10 Aside Coverage: N/N files · N/N hunks with a bar. If Claude's plan misses hunks, the app adds them to an… (bc15516, df6afea, 95ba9b0)
- [x] F-06.11 Actions: Browse files instead (S-06-like browse of the MR), Start step 1 (Enter). (95ba9b0, 7367e08)
- [x] F-06.12 While steps are being analyzed, the title bar shows status ("Plan ready · Claude is analyzing step 1").… (7da45d0, 79e1527, 95ba9b0)
- [x] F-06.13 If the change touches review or Claude configuration (CLAUDE.md, AGENTS.md, .claude/, .mcp.json… (d951f6f, 355331f, 95ba9b0, 81423f9)
- [x] F-07.1 Three layouts switchable in the title bar and with Ctrl+1/2/3, sharing all state: A Sidebar (steps list… (f604e59, d88eac2, 3976bc2, 48cdbf3, ecc02ae, 19fdc34, b68e9e3, 4fd5c0d)
- [x] F-07.2 Step header: "STEP 4 OF 8", title, a one- or two-sentence description; Mark reviewed (Space) and next. (9748265, 530d516, f604e59, ecc02ae, ce90ddc)
- [x] F-07.3 File header: path, +add −del, number of notes in this file ("3 notes"). (9748265, 530d516, f604e59)
- [x] F-07.4 Split diff with old/new line numbers, intraline emphasis and syntax highlighting. Mechanical regions… (2575c46, f604e59, d88eac2)
- [x] F-07.5 Gutter markers: in A and B a 12px square colored by severity; in C a numbered square. A thread icon marks… (2575c46, f604e59, 3976bc2)
- [x] F-07.6 The focused note opens inline under its line (A, B) or in the guide panel (C). Card: severity tag, title… (87b700d, f604e59, d88eac2, 3976bc2)
- [x] F-07.7 Layout C shows "Worth a look": numbered notes in line order, the focused one expanded; "+N minor"… (3976bc2, 48cdbf3, ecc02ae, ce90ddc)
- [x] F-07.8 Layout B's toolbar: previous, "Step 4 of 8", next, Mark reviewed, Ask Claude. (3976bc2, ecc02ae, ce90ddc)
- [x] F-07.9 The chosen layout is remembered globally and per session. (6c15e0f)
- [x] F-09.1 Each note has severity, title, body, line (file, side, line), evidence (file:line list) and a suggested… (75dcfbd, 8d92b37, 1f1e6c5, b42a11c, 4772c33, 87b700d, fb9bfc6)
- [x] F-09.2 Decisions: Add to drafts (creates a draft from the suggested comment), Edit and add (opens the text for… (1f1e6c5, b645db8, b42a11c, 4772c33, 87b700d, f1f5aa2, de40ad0)
- [x] F-09.3 After Add to drafts the card says "Added to drafts. It reaches GitLab only when you publish." After… (87b700d)
- [x] F-09.4 Dismissed notes are fingerprinted (rule = the note's kind + file + normalized code: the line with… (8d92b37, 75dcfbd, 513d0fa, 1f1e6c5, b42a11c, 87b700d, 78ee197, cdfe51d, 5c8cf1b, a7e25d1)
- [x] F-09.5 Notes never duplicate existing GitLab threads on the same line and topic (Claude gets the thread list as… (513d0fa, 39c183c, c2d9e0d, 60c8232, a06cf62, 36e569b)
- [x] F-09.6 Notes appear progressively: steps are analyzed in the background, the next step is pre-fetched while the… (6692508, 513d0fa, a39b778, b42a11c, 4772c33, 87b700d, f604e59)
- [x] F-10.1 Questions are asked in the context of the current step and, if any, the selected lines. (3ed3792, b42a11c, 4772c33, 0f656e9, 3976bc2, e5af190, 9f84351, f9601e0, 19b7f13)
- [x] F-10.2 Answers stream in. Follow-up questions continue the same Claude session (--resume). (3ed3792, a39b778, b42a11c, 4772c33, 0f656e9, 3976bc2)
- [x] F-10.3 An answer can be turned into a draft comment with one click. (0f656e9, 3976bc2)
- [x] F-17.1 Same plan and step flow as an MR, on the selected local scope; worktree is not needed (reads the working… (3558aee, 2ee03a6, efbb6ac, 04c59e1, 6f51f58, a88fa46, dcd5083, 8962057, 6a887df, 7d8dec4)
- [x] F-17.2 No publish, approve or thread actions are shown. Notes can be turned into a "fix list" and into Fix with… (1f1c357, 4cbb9ea, 2294ab0)
- [x] F-17.4 The self-review summary reuses the S-05 drafts list styling without publish, approve or threads: notes… (9b5ffbe, 5f7e17f, 4fb5358, 4a02d04)

## M4 · Detailed mode and keyboard
- [x] F-08.1 Mode toggle Focus | Detailed in the title bar (Ctrl+D); both modes show the same session state. (af6e739, 7a0fb2f, 795c3ac, f07006d, fb01a71, cf55c6a, 6e108e3)
- [x] F-08.2 Info header: branch block, author · age, N files +add −del, step progress segments with done/total, drafts… (1f3ecd3, 5bd075b)
- [x] F-08.3 Rail: a first item "Change overview" (intent, risks, plan; links to S-02, done once the plan was opened)… (8be2ace, 38a4f7a, e007555, 505ce1b, c29b077)
- [x] F-08.4 Step header: "Step 4 / 8", "builds on" chips (click jumps to that step), previous, Mark reviewed (Space)… (2f5ce76, d1eab46, b374056, 083a2e8)
- [x] F-08.5 Sticky file bar: path, +/−, Split | Unified, Ignore whitespace, Open in Rider. (6cc2631, d41bb52, 9713c4e, f224f5b, 33293d7)
- [x] F-08.6 Full note callout: tag, title, Claude label, body, "Checked in" evidence chips, Suggested comment, Add to… (3b09fa2, 165a85e, a342000)
- [x] F-08.7 Guide aside: Code notes in line order (N cycles), "For you to judge" checklist with progress (1/3)… (afbfa8d, f8e28b8, 4b2676d, 5be0a7b, af9c795)
- [x] F-08.8 Footer: shortcut hints (J K hunk, [ ] step, N note, C comment, A ask, Space reviewed, ? all) and Claude… (353d192, 4f6d63a, 907fc3a, a7e8554, 9326c81)
- [x] F-08.9 End-of-step card: "End of step 4", next step title with stats, Next step. (157eac8, cc19376, 404222a)
- [x] F-09.7 C (or the comment action on a selected line) opens an inline composer under the line in the note-card… (991f647, d8ea6c8, ef68a16)
- [x] F-19.1 General: Start in (Focus/Detailed), Focus layout (A/B/C), Diff colors (Blue · orange / Green · red), Start… (d17fe88, a01427a, 9efd76e)
- [x] F-19.3 Shortcuts: list of all shortcuts in F-30.6, grouped (Review, Code, App). (22b9148, 169a20d)
- [x] F-30.3 Finish review (review screens) opens S-05. (ee41de3, f2d70ce)
- [x] F-07.10 Each file of a step can be marked reviewed on its own (S-03 and S-04): Space toggles the current file… (740c339, ce99121, 37f9f1a, 1667e3a, ef85005)
- [x] F-30.6 Shortcuts: ↓/↑ next/previous change (a change taller than the screen scrolls a screen at a time first;… (cf57cb9, 56d19f5, 004936e, 1518e85, 2bd46af, 7ecf85f, b8fb09f)
- [x] F-19.7 Shortcuts can be changed in Settings › Shortcuts: a row's keys are a button ("Change shortcut for <action>");… (af369bf, f2b6d46, 49c5c75, 5c8591d, 816fc36, 16dec67)

## M5 · Talking to GitLab: threads, publish, approve
- [x] F-11.1 Threads on lines in the current step show inline (avatars, author · age, text, replies). (497757e, f1a6090, ba6e480)
- [ ] F-11.2 Actions: Resolve (green), Reply, Reopen on resolved threads. Resolve/unresolve are sent immediately and… — partial: autopilot (398585a, f753db9, dbdf75d, 4141214, 862d1cb, c3bff09)
- [ ] F-11.3 Threads on outdated lines (from an older version) are shown on the closest matching line (same line text… — partial: autopilot (e4d7d22, 9dacf17, 001ba1b, 5756c64, b476d4e, fdf25ae, a23c36b, ea1568c, 5eca792)
- [x] F-12.1 "SUMMARY" with "All N steps reviewed." (or "N of M steps reviewed.") and Back to steps. (3615ea0, 61bcd54)
- [x] F-12.2 Tabs Drafts N and Threads N open. (d007913, 47f94e7, 7c64225)
- [x] F-12.3 Drafts list: checkbox (include in publish), severity square, text, file:line, edit pencil. Note "Only you… (585dfc0, ee53bd6)
- [ ] F-12.4 "Add a summary comment" checkbox reveals a text area prefilled by Claude with a short overall summary. — partial: built, live check with a real claude run on the stand-in MR left; autopilot (4a6c22a, 479b0a3, 6ebb047, e585cc3, 61059a8, ae7ef8c)
- [ ] F-12.5 Publish (N) publishes the selected drafts (and summary comment) in one batch so the author gets a single… — partial: built; decision 10b re-map to a newer MR version not built, restored-start check of GitLab own drafts open (locked test MrSummaryPublish.test.tsx:509), stand-in check left; autopilot (fdaf618, 0efc71b, 7b2aa75, 80f3e79, 84ca621, a020f7b, dd171af, 5923114, 2478396)
- [x] F-12.6 Publishing never approves the MR. (1c0614f, a5cf645)
- [x] F-12.7 Drafts belong to the MR (project + iid). Drafts added outside a review (Explain failure on S-08, Add as a… (8877384, 701d723, f2df53b, 195c8ce, 5d31146, 5154260, ffb92ba, fefb3eb)
- [x] F-13.1 Filters All / Open N / Resolved N. (4e12932, 78d23b4)
- [x] F-13.2 Each thread: first message, author · replies · file:line, Resolve or Reopen. (f444a33, c10ba3b, 6a38fa3)
- [ ] F-13.3 Claude hint chip when the thread looks addressed by a later commit ("Claude: index added in a91f2c0"). — partial: autopilot (421d7b8, 58b0531, 362cf80, 9e86162, d465348, 90e801e)
- [ ] F-14.1 Approval tile: state ("NOT APPROVED YET" with dashed square / approved in solid green), "Approvals: X of…
- [ ] F-14.2 Approve MR / Revoke approval. Approval is sent with the head SHA that was reviewed; if the MR changed…
- [ ] F-14.3 The tile states "Approving doesn't publish comments." and the number of open threads ("Open threads: 3."…

## M6 · Pipelines
- [ ] F-20.1 Shows the MR's pipelines as tabs (newest first, "version N · latest"), the selected pipeline's status…
- [ ] F-20.2 Stages as columns with job rows: status square (passed ✓, failed ✕, failed-allowed !, running spinner…
- [ ] F-20.3 Run new pipeline asks for confirmation ("Run a new merge request pipeline on <sha>? Uses the MR's latest…
- [ ] F-20.4 Retry failed jobs (pipeline), Cancel pipeline (while running), Open in GitLab.
- [ ] F-20.5 Selecting a job shows details: name, status, stage, duration, Retry/Cancel, Full log; the log tail with…
- [ ] F-20.6 Manual jobs show their description (when GitLab provides one) and editable variables ("Variables for this…
- [ ] F-20.7 Failed jobs offer Explain failure: Claude reads the log and the MR diff and returns a verdict (Caused by…
- [ ] F-20.8 Successful jobs list artifacts with Download.
- [ ] F-20.9 A retry that fails the same way says "Retried: failed again on the same test."
- [ ] F-20.10 Pipeline status everywhere (S-01 rows, S-02 meta, S-04 header, S-10 title bar) links to S-08.

## M7 · Own code: fix, author mode, new MR
- [ ] F-17.3 At the end it offers a draft MR description (F-27.2) and Browse and commit.
- [ ] F-25.1 Available in self-review notes and author-mode threads. Never offered on a teammate's MR.
- [ ] F-25.2 Claude works in an app-managed scratch copy of the working tree, never in the user's working copy, and may…
- [ ] F-25.3 The proposal shows as a diff card "Proposed change · Edited 1 file: <name>" with a one-sentence…
- [ ] F-25.4 Accept writes the change into the working copy (unstaged) only if the file is unchanged since the run…
- [ ] F-26.1 Title bar shows "You're the author" (blue) and pipeline status. Left panel: "FEEDBACK ON YOUR MR", "N…
- [ ] F-26.2 The selected thread opens in the code at its line with the conversation and actions Fix with Claude, Fix…
- [ ] F-26.3 Fix in Rider opens the file at the line and watches the working tree; a detected change continues the flow…
- [ ] F-26.4 After a fix: commit panel with a suggested message, "As a fixup of <sha> "<subject>"" (default on) with…
- [ ] F-26.5 After commit: "Committed <sha> · not pushed yet", the reply to be sent ("Fixed in <sha>. <one…
- [ ] F-26.6 After push: "Pushed · Replied to <name> and resolved the thread." and a link to the new pipeline.
- [ ] F-26.7 Question threads: reply text area, Draft with Claude (fills a proposed answer), Send reply (immediate).…
- [ ] F-26.8 If the user's checkout isn't on the MR's source branch, author mode is read-only with "Check out <branch>…
- [ ] F-27.1 Opened from "Push and create MR" (S-06), self-review end, or Rider. Branch block source → target (target…
- [ ] F-27.2 Title and description prefilled by Claude from commits and diff; description sections What, Why, How to…
- [ ] F-27.3 Reviewers suggested with reasons: code owner (CODEOWNERS), "Wrote N% of the changed lines" (git blame)…
- [ ] F-27.4 Options: Mark as draft, Delete branch after merge (default on), Squash commits.
- [ ] F-27.5 Before you create: Branch pushed, No conflicts with <target> (local git merge-tree), Self-review done…
- [ ] F-27.6 Create merge request / Create draft MR; note who gets notified. Success screen: "!483" big green block…

## M8 · Re-review and moved code
- [ ] F-04.2 If the MR head moved since the session started, the card shows an orange tag "N NEW COMMITS", a primary…
- [ ] F-21.1 Opened from "Only new changes" (S-01), a tray notification, or when an open session detects a newer MR…
- [ ] F-21.2 Heading "N CHANGES TO CHECK" with "<author> force-pushed <age> and rebased onto <target>." and a primary…
- [ ] F-21.3 Compare control: from version (v1, v2 … with a "you" marker on the version last reviewed) → latest.
- [ ] F-21.4 Commits list from git range-diff with word tags: Same (patch identical after rebase), Changed (N hunks…
- [ ] F-21.5 Rebase noise: "Rebase brought N commits from <target>. Hidden: they aren't part of this MR." with…
- [ ] F-21.6 Selecting a commit shows Claude's one-paragraph summary of what changed and a split diff "Version 2 · your…
- [ ] F-21.7 "Your review so far": steps still valid / steps to look at again; drafts on changed code with Claude's…
- [ ] F-21.8 Only changed commits become steps; unchanged steps keep their reviewed state.
- [ ] F-22.1 Blocks moved between or within files are detected and collapsed to one row: "MOVED · 16 lines from <file>…
- [ ] F-22.2 Small edits inside a moved block are shown ("1 LINE CHANGED" tag) and, when expanded, unchanged moved…
- [ ] F-22.3 The origin side of a move shows "Moved to <file> L44–59" instead of a full deletion.

## M9 · Code navigation
- [ ] F-23.1 Symbols in the diff are clickable (dotted underline). Clicking shows a hover card above the line: kind tag…
- [ ] F-23.2 Definition opens an inline peek panel under the line with the definition's code, a tag "In this MR" / "Not…
- [ ] F-23.3 Usages opens a side panel grouped In this MR (with step) and Outside this MR (marked "not changed"). Each…
- [ ] F-23.4 When usages outside the MR may be affected, Claude adds a short insight with Add as a question (creates a…
- [ ] F-23.5 File bar shows index status ("Code index ready · csharp-ls"); without an index the app falls back to a…

## M10 · Desktop integration and team rules
- [ ] F-24.2 The app registers the guidedreview:// protocol; guidedreview://mr/<iid>[?project=<path>] opens the MR plan…
- [ ] F-24.3 Settings › Integrations › Add to Rider creates External Tools "Review this branch" and "Review this…
- [ ] F-28.1 The app keeps a tray icon (yellow mark with an orange count badge; grey when paused). Closing the window…
- [ ] F-28.2 Polling GitLab every N minutes (1, 3, 5, 10, 15; default 3) for: review requests, new commits on MRs I…
- [ ] F-28.3 Windows toast per event with title, body and two buttons (e.g. Start review / Later, Re-review / Later).…
- [ ] F-28.4 Tray menu: "GUIDED REVIEW", "Checked 1 min ago", settings shortcut; groups Waiting for you, Changed since…
- [ ] F-28.5 Quiet hours (default 18:00–08:00 and weekends; from, to and weekends editable) suppress toasts but keep…
- [ ] F-29.1 Claude reads .review/rules.md before every plan and step analysis, taken from the target branch (git show…
- [ ] F-29.2 When the user dismisses notes of the same kind N times (default 3) across MRs, the app shows a suggested…
- [ ] F-29.3 Actions: Propose in an MR (creates a branch and an MR changing .review/rules.md, reviewer = code owner)…
- [ ] F-29.4 The rule takes effect only after that MR is merged. The section lists the current rules with author and…
- [ ] F-29.5 Dismissal statistics stay on the user's machine.

## M11 · Hardening and release
- [ ] NFR-01 Performance: Cold start to interactive S-01 < 1.5 s. Reopening a cached MR session < 300 ms to first diff…
- [ ] NFR-02 Responsiveness: Every long operation (git fetch, Claude task, GitLab call) is async, shows progress and… — partial: child processes are async, cancellable and time out with their whole tree (7deb140); progress UI per feature
- [ ] NFR-03 Reliability: Claude or GitLab failures never lose user work (drafts, decisions, commit messages). Failed… — partial: GitLab 429 reports `Retry-After` (6a228e7); retries with backoff and keeping work on failure from M2/M5
- [ ] NFR-04 Security: See 06-security.md. Highlights: token in Windows Credential Manager, Claude read-only on others'… — partial: token only in Credential Manager with a masked Debug form, both Claude profiles with `--restricted` as argv snapshots, no shell (926b71a, 6a228e7, 7deb140); the rest of 06 per milestone
- [ ] NFR-05 Offline: Without network the app opens cached sessions read-only and says so; local self-review and commit…
- [ ] NFR-06 Accessibility: Keyboard reachable everything, visible focus (2px yellow outline), ARIA roles on…
- [ ] NFR-07 Platform: Windows 10 22H2+ and Windows 11, x64. Code should stay portable (macOS/Linux later), so no…

## Session log

Rows for the kickoff and M0–M3 (merged to main in PRs #1–#6) were removed on 2026-10-16; they are in git history: `git show 7c95acd:docs/PROGRESS.md`.

| Date | Milestone | What was done | Next |
| - | - | - | - |
| 2026-10-15 | M4 · autopilot run ap-20261015-1609 | **M4 plan (d7a3535, 14 decisions D-18) and 6 of 14 criteria merged: F-08.1 (d2da090), F-08.2 (80e1f4d), F-08.3 (b5fcb60), F-08.4 (ec59df7), F-08.5 (5982195), F-08.6 (bbd2c9f).** Gate first pass 6/6, fix rounds on 4 (two accepted test disputes, an invisible focus ring, a missing step-load error); 65 decisions in D-18 to D-24; playbook +8 lessons, curator bafd9d1. Stopped by the owner; F-08.7 tests locked (9b7279f), implementer not run. Mean 44 min per criterion (31–61): tests ~12, implement ~17, review ~7. Found: backlog keeps kind 'mixed' when the first sync ran before the plan (implementer stayed on Opus; owner wants Opus anyway). Owner priorities: quality, time, cost. Not tried in the real app: Ctrl+D in WebView2, sticky bar, Open in Rider, Continue into Detailed. S-04 runs the step analysis on open, as S-03 does. Tasks 6/14. Next: autopilot continues M4 from F-08.7. |
| 2026-10-16 | M4 · process E22 tests ahead | **Tests ahead (2d6538f): while item X is reviewed, fixed and gated, the test author of the next ready item writes its tests in the background in a second fixed worktree `../gr-ap-2` (port 1511), on a branch from X's tip; implementations stay one at a time.** `worktree.mjs ahead/discard`, `ready` merges the milestone branch (lock = the merge) or discards the tests (X not merged, conflict); backlog status `tests-ready`; gate `commits` without merges; conductor waits without the marker (Stop hook does not push it); e2e in a spec per criterion; `judge` summary `pace`, `disputes`. 77 tool tests, /verify green. Baseline from `.metrics/items.jsonl`: gate first pass 6/6, accepted test disputes 3/6. Follow-up: the autopilot judges E22 itself at Closing (`judge.mjs --run … --against …`) and the retro skill applies it; tokens of ahead authors count for their item. Never run live yet. Tasks 3/3 (guard at 200k during task 2) | Next: owner types `/autopilot start M4 --cap 3` (first trial of E22: F-08.7 resumes, then F-08.8, F-08.9); the autopilot judges E22 itself, nothing waits for the owner |
| 2026-10-16 | M4 · autopilot run ap-20261016-1235 + PR | **M4 complete: 16 of 16, audit without gaps; PR #7 to main.** Run: F-07.10 file marks (7910c33), F-30.6 arrow-key walk, attempt 2 (1d47d99), F-19.7 editable shortcuts (5d396ce); one fix round each (severe: the step-start pause skipped a step in F-30.6, single-letter keys swallowed typing in F-19.7), 3 accepted test disputes. Live checks F-07.10 and F-30.6 passed on MR !4 (95f0f97). Decisions D-32 (appended), D-33, D-34. Cleanup: kickoff and M0–M3 session-log rows and `docs/questions.md` removed (97bb6e0). Full verify: e2e 153/153, Vitest 726/726 on the re-run (3 load timeouts in F-09.7 tests). Open: the model chip shows Haiku on MR !4 step screens; Space after a toggle click marks the clicked file (follow-up proposed). Tasks 2/2. | Owner: merge PR #7; then on a new branch `m5-…` from main type `/autopilot start M5` (the planner writes `docs/plans/M5.md` first). |
| 2026-10-16 | M5 · autopilot run ap-20261016-1738 | **M5 started on `m5-threads-publish` (from main after PR #7); plan d858918 (16 rows, decisions D-35); 3 of 16 merged: F-11.1 thread cards in S-04 (f76060e, done), F-11.2 Resolve, Reply, Reopen (2898715, live), F-11.3 threads from an older version placed by line text or on the file header (7ce6cca, live).** Fix rounds: removed-line icon in Unified (F-11.1); reply text lost on scroll or Resolve (F-11.2); threads on renamed files and folds hiding threads (F-11.3); 1 accepted test dispute (a restored step has no threads, D-07/D-36). One gate failed on Vitest timeouts caused by other programs loading the CPU. Decisions D-35 to D-38; playbook P-083 to P-087. Stopped by the owner: F-12.1 tests locked (50c8bb3), implementer not run. E22 stays kept; this run's pace (66.7 min) not counted (owner). Tasks 3/16. | Next: `/autopilot start M5` from F-12.1; its Closing runs the live checks of F-11.2 and F-11.3. |
| 2026-10-17 | M5 · autopilot run ap-20261017-0624 | **5 of 16 more built and merged: F-12.1 summary heading (bd95a54, done), F-12.2 Drafts/Threads tabs and `gitlab_discussions` (de39b86, done), F-12.3 drafts list (f0bb1fa, done), F-12.4 summary comment by Claude (8df6ace, live), F-12.5 Publish in one batch (5be1992, partial).** Fix rounds: screen-reader status for the summary labels (F-12.4); F-12.5 retry sending stale or unticked notes, a lost summary failure, summary-only publish (decision 7), no fallback to another MR version; 1 accepted test dispute (wiremock closed port). F-12.5 open: decision 10b re-map, restored-start foreign-drafts check, DELETE/versions endpoints to verify on 17.11.7. S-03 F-09.7 Vitest timeouts failed 4 of 9 gate calls; a serial gate verify (1a4798b) was reverted by the owner, gates stay parallel; default cap 4 (c0eed02, owner); playbook curated 76→58 (4d598f8). Full verify green. Decisions D-39 to D-43. Paused once by the usage limit, ended by the owner. Tasks 5/12. | Next: `/autopilot start M5` (F-12.6 tests ready, then F-12.7, F-13.1, F-13.2); its Closing runs the live checks of F-11.2, F-11.3, F-12.4. |
| 2026-10-18 | M5 · autopilot run ap-20261018-1736 | **2 more built and merged: F-13.2 thread rows on the Threads tab with Resolve/Reopen and Show in code (b6b5d38, done, gate on the first call, 2 review nits), F-13.3 Check with Claude and the hint chips (a93eb68, live).** F-13.3 in two passes (core, screen); the thread-check prompt and schema in `docs/claude` rewritten to the locked contract (PROMPT_VERSION 3); new token `--purple-tint`; eslint lets test doubles keep `_` parameters; one fix round (the status region stays in the accessibility tree). F-14.1 tests written ahead (af04ce5, tests-ready). Decisions D-46, D-47. Headroom MCP tried: 0 tokens saved (the content has to pass through the context first). Stopped by the context guard at 206k, so no live checks (STOP). Full verify green. Tasks 2/4. | Next: `/autopilot start M5` (F-14.1 tests ready, then F-14.2, F-14.3); its Closing runs the live checks of F-11.2, F-11.3, F-12.4, F-13.3. |
