# 02 · Screens

One section per screen. For each: the mock file and screenshots (the visual truth), how you get there, the regions from left to right and top to bottom, the states the mock doesn't show, the data it needs and the features (`F-xx`) it implements.

**How to read the mocks.** `docs/design/mocks/*.dc.html` are interactive HTML mocks. The markup and inline styles are the exact visual spec (sizes, colors, fonts, spacing). The `<script type="text/x-dc">` block holds example data and the mock's interaction logic; use it to understand behavior, never copy its runtime. `docs/design/screens/*.png` are renders of the mocks in specific states. To render any mock in any state yourself: `node tools/mock-preview/render-mock.mjs <Mock.dc.html> --state '<json>'` (see `design/README.md`).

**Data in the mocks is example data** (mobile-app, !482, Marta K.…). The real app shows real data from git, GitLab and Claude. The same example data goes into the mock backend (`src/ipc/mock/fixtures/`) so screens can be compared with the PNGs one to one. Where the mocks disagree with each other (e.g. step 4 is titled differently in S-02, S-03 and S-04, and S-04's heading is longer than the schema allows), the fixtures use one canonical set: the S-02 titles, the S-03 A sidebar labels as `short_title`, and 1–2-sentence descriptions; `/design-check` treats the remaining text differences as data differences.

**"Data:" lines** name the needed operations informally (`gitlab.list_mrs`); the actual IPC command names and groups are defined in `04-architecture.md` › IPC contract.

## Shell (all screens) · F-30

- **Title bar** 44px, background `#0A0A0A`, draggable; double-click maximizes. Left: 26px yellow logo square with the black "H" mark, repository (switcher on S-01 and S-06, F-30.7; plain muted text elsewhere), context. Right: screen controls, then Windows caption buttons (46px wide each; close hover red `--caption-close-hover` is the only exception to the palette). Windows 11 may round the window's own corners; that's OS chrome and stays. The Snap Layouts flyout on Maximize is not provided in M0 (revisit in M11).
- **Dock** 72px, background `#0A0A0A`, tiles 58px wide: MRs, Review, Changes; Settings pinned to the bottom. Active tile = filled with its color and black ink. Settings is always purple; active Settings gets a 2px white outline. Review without an unfinished session is dimmed with the tooltip "No review open. Pick one in MRs." (F-30.2).
- **Content** fills the rest. Panels use fills (`#141414`, `#1A1A1A`…) instead of borders; corners are square.

Controls whose behaviour belongs to a later milestone are rendered as static placeholders until then (`07` › Criteria that point at later milestones).

| Screen | Dock tile active | Title bar controls |
| - | - | - |
| S-01 Start | MRs | repository switcher, GitLab status, Claude status chip (purple square; takes the model chip's place and opens Settings › Claude) |
| S-02 Plan | Review | status text, model chip (plan task) |
| S-03/S-04 Step review | Review | Focus/Detailed, layout switcher (Focus only), progress segments (layout B), model chip (step task), **Finish review** |
| S-05 Summary | Review | model chip (MR & pipeline task: summary comment) |
| S-06 Changes | Changes | branch block, model chip (commit task) |
| S-07 Settings | Settings | — |
| S-08 Pipeline | Review | model chip (MR & pipeline task) |
| S-09 Since last review | Review | model chip |
| S-10 Author mode | MRs | "You're the author" tag, pipeline status, model chip |
| S-11 New MR | Changes | branch block, model chip (MR task) |

---

## S-01 Start · MRs and source picker
- Mock: `Start.dc.html` · Screens: `S01-start.png`, `S01-start-mine-tab.png`
- Entry: app start, MRs tile, `Ctrl+K`, tray "Open app".
- Regions:
  1. Hero: "WHAT ARE WE REVIEWING?" (56px condensed), input with detected-type block and **Start**, hint "Ctrl K opens this field from any screen." (F-01)
  2. "Pick up where you left off": resume cards (F-04). Until M8 a card shows **Continue** only; the "N NEW COMMITS" tag and **Only new changes** (F-04.2) come with S-09 (M3 decision 10; design-check justification). From M8 (D-84):

     | Card state | When | Tag after the progress line | Buttons |
     | - | - | - | - |
     | No newer version | the MR head equals the session's version, or a self-review card | none | **Continue** |
     | New commits | a newer MR version, N ≥ 1 | orange "2 new commits" ("1 new commit"); N is the S-09 count of changes (`05` › Re-review), so both screens show the same number | **Only new changes** (yellow, opens S-09), **Continue** (neutral) |
     | Counting | a newer version, N not computed yet | orange "New version" | as New commits |
     | Count failed | the fetch or range-diff for N failed | orange "New version" (no error on S-01; S-09 shows it) | as New commits |
     | Only a rebase | a newer version, N = 0 | grey "Rebased" (the Dropped tag colours of S-09) | as New commits |
     | Re-review in progress | after **Review N changes** (S-09) | progress line "Since v2 · 1 of 3 steps · 2 drafts" | as the rows above |

     Checked when S-01 opens, on window focus and on the F-02.4 timer, for unfinished MR sessions only. **Continue** opens the session where it was, on its own version.
  3. Three columns: **Merge requests** (blue header, tabs, rows; F-02), **Commits** (white header, search, selectable list, Review/Browse; F-03), **My changes** (green header, scope radios, Review before push / Browse and commit; F-03)
- States: GitLab not configured → Merge requests column shows "Add your GitLab token" with a button to S-07 › GitLab; repository not a git repo → My changes column shows "Pick a repository" (folder dialog); Commits header shows the current branch (F-03.1; the mock's `develop` is its sample current branch); a commit search without matches → "No commits match."; empty tabs → "Nothing waiting for you." (Waiting for me), "You have no open merge requests." (Mine), "No open merge requests." (All open); loading → 3 skeleton rows; MR lists older than the polling interval → "Updated 7 min ago" in the Merge requests header (F-02.4); input errors under the input (F-01.5): "No merge request !999 in mobile/mobile-app", "No commit, branch or repository matches “x”.", "x is not the configured GitLab server.", "mobile/x is not one of your repositories. Add it in Settings › GitLab."
- Data: `gitlab.list_mrs(tab)`, `sessions.list_unfinished()`, `git.log(branch, query)`, `git.status_summary(scope)`, `app.health()`.

## S-02 Review plan
- Mock: `Overview.dc.html` · Screen: `S02-plan.png`
- Entry: MR row, `Start` with MR input, `guidedreview://mr/<iid>`, tray.
- Regions: header (title, meta, actions) · left: "What this change does", plan list with strategy toggle, Skim row · right aside: Risks to check (app-generated config-change risks first, F-06.13), MR description vs code, Already discussed, Coverage. (F-06)
- A step's reason doesn't change with the strategy (the mock's alternative reason for step 8 under Tests first is ignored).
- States:
  - Preparing (F-05): heading shows the MR title, the plan area shows progress lines ("Fetching !482", "Creating worktree", "Computing diff · 16 files"; done stages green, the current one yellow, later ones muted), Cancel (back to S-01). It appears once GitLab returned the MR (the first stage carries the title), so "No merge request …" (F-01.5) stays on S-01. A failure after that keeps the screen: the failed line is orange, the core's message below it, and the action becomes **Back to start**. No mock: built from this text (design-check justification).
  - M2 (M2 decision 2): header per F-06.1 (pipeline as GitLab reported it at preparation), the plan region shows "The review plan comes with M3. Browse files instead to read the change.", **Browse files instead** opens S-06 MR browse, **Start step 1** / Enter opens the S-03 stub. Title bar: repository, `!iid`, "Review plan"; the plan status (F-06.12) comes in M3.
  - Planning: the header (from the session) is shown immediately; the intent region shows a calm placeholder "Claude is planning · usually under a minute", **Start step 1** waits; the plan list and the aside appear with the result. Title bar status: "Claude is planning".
  - Claude failed or not signed in: `review_plan` returns the app's fallback plan (`PlanView.fallback` = the error, never cached): one step per layer group (F-05.4) in GitLab file order, titled with the layer, the files' names as the reason; config risks (F-06.13), "N open threads." (F-06.9), coverage; no intent, skim or claims. The banner "Claude isn't available. You can review in file order." with Retry takes the intent's place; the strategy toggle shows File order with the other two disabled, rows don't drag, empty aside sections are hidden. Title bar status: "Claude isn't available".
  - Ready: when the plan arrives, S-02 starts the analysis of the first step in the order (F-06.12); the title bar shows "Plan ready · Claude is analyzing step 1" while it runs, then "Plan ready".
  - Cached: everything appears at once; status shows "Plan from cache · <age>".
- Already discussed (F-06.9, M3 decision 5): the summary text comes from Claude (`already_discussed`); without Claude it says "N open threads." from the discussions count. Threads load from GitLab when the plan runs and when a step opens; MR sessions only.
- Data: `review.open_mr(iid)` (session + preparation events), `claude.plan(session)` (channel), `gitlab.mr_detail`, `gitlab.discussions`.

## S-03 Step review · Focus mode (layouts A, B, C)
- Mock: `Review.dc.html` · Screens: `S03-focus-layout-A.png`, `S03-focus-layout-B.png`, `S03-focus-layout-C.png`
- Entry: Start step 1 (S-02), Continue (S-01), step chips.
- Layout A "Sidebar" (`Ctrl+1`): steps list left with short titles (done = green check square, current = yellow row, others numbered), "Skim · N files" at its bottom; main column: "STEP 4 OF 8", title (34px condensed), description, **Mark reviewed** (neutral button in A, as in the mock; yellow in B and C) + next arrow; file header; diff; inline note and thread cards.
- Layout B "Minimal" (`Ctrl+2`): no sidebar; 8 progress segments in the title bar; floating toolbar centered at the bottom (prev, "Step 4 of 8", next, **Mark reviewed**, **Ask Claude**).
- Layout C "Guide" (`Ctrl+3`): diff left; guide panel right (progress segments, step title and description, "WORTH A LOOK" numbered notes with the focused one expanded, "+1 minor", large **Mark reviewed**, "Ask Claude about this step…" input). Gutter markers are numbered.
- Thread cards (F-06.9) are read-only until M5: avatars, author · age, text and replies, shown as step context. **Resolve**, **Reply** and **Reopen** arrive with F-11 (M3 decision 1; design-check justification for the buttons in the PNGs).
- Self-review (a session of commits or local changes, F-17.2): there is no MR, so no thread icon or card shows, and nothing offers publish, approve, resolve or reply. Note cards and the answer card say **Keep to fix** and **Edit and keep** (copy in S-05); in layout C a kept note's row says "to fix" where an MR session's says "in drafts".
- Focus | Detailed toggle in the title bar: shown; **Detailed** opens the S-04 stub until M4; `Ctrl+D` comes with M4 (M3 decision 8).
- States: step analysis pending → notes area says "Claude is reading this step…" with spinner, diff fully usable; analysis failed → "Couldn't analyze this step." Retry; no notes → "Nothing stood out. Read it yourself, though." (no fake praise).
- Answer card (F-10; no mock, M3 decision 4): note-card style with the purple Claude square, the streamed answer text, a follow-up input, **Add to drafts** and **Copy**. A and B: inline under the selected lines, or under the step header when nothing is selected. C: in the guide panel above the ask input. B's **Ask Claude** and More › Ask Claude open it with the input focused.
- Data: `review.step(session, step_id)` (hunks, threads), `claude.step_findings(step_id)` (cached or channel), `review.decide(finding_id, decision)`, `review.mark_step(step_id, reviewed)`.

## S-04 Step review · Detailed mode
- Mock: `Main.dc.html` · Screen: `S04-detailed.png` (1600×1040)
- Regions: info header · rail ("Change overview", plan, skim, coverage) · main (step header, H1, description, sticky file bar, diff with full callouts, end-of-step card) · Guide aside (Code notes, For you to judge, Analysis context with each file's place, Ask box) · footer (shortcuts, Claude status). (F-08)
- The manual line comment composer (F-09.7) opens under the line in the note-card style, in both modes.
- The mock's Tweaks (diff colors, show inline, accent) map to Settings › General (Diff colors). "Show inline" off = notes only in the aside.
- States: same as S-03.

## S-05 Summary
- Mock: `SummaryDesk.dc.html` · Screens: `S05-summary-threads.png`, `S05-summary-drafts.png`, `S05-summary-published.png`, `S05-summary-approved.png`
- Entry: **Finish review** in the title bar, last step's Next.
- Regions: heading "SUMMARY", progress line, **Back to steps** · left: tabs Drafts/Threads, list, Publish · right: Approval tile. (F-12, F-13, F-14)
- States: publish in progress (button shows spinner, list locked); partial failure ("Published 3 of 5. 2 failed: <reason>." with Retry, failed items keep their checkbox); MR changed since review (yellow banner "The MR has a new version since your review." → S-09; approve disabled until acknowledged); approved with unpublished drafts (F-14.3 copy); "drafts only" session opened from S-08 or S-12 (F-12.7; progress line omitted).
- Draft checkboxes are blue (they select what is published), unlike the green staging checkboxes.
- **Self-review summary** (F-17.4): same layout and drafts list styling, no Publish, no Threads tab, no Approval tile; notes kept "to fix" with **Copy as checklist** (and Fix with Claude per item from M7). Heading "SUMMARY", progress line "All 6 steps reviewed." / "4 of 6 steps reviewed.", **Back to steps**; an empty list says "Nothing to fix." Self-review note cards say **Keep to fix** (confirmation "Kept to fix. It's on your list at the end.") and **Edit and keep**; Dismiss keeps its copy (F-17.2, M3 decision 2).
- **Finish review** in M3 (M3 decision 9): a self-review opens the self-review summary; an MR session opens the S-05 stub until M5, while its drafts stay local.
- Data: `drafts.list(session)`, `drafts.update`, `gitlab.publish_drafts(session, ids, summary?)`, `gitlab.discussions`, `gitlab.resolve(discussion, bool)`, `gitlab.approve(sha)`, `gitlab.unapprove()`, `gitlab.approval_state()`.

## S-06 Changes and commit
- Mock: `Changes.dc.html` · Screens: `S06-changes-local.png`, `S06-changes-commit.png`, `S06-changes-committed.png`
- Entry: Changes tile, Browse files (S-01, S-02), Browse and commit.
- Regions: left tree panel (source toggle, filter, master checkbox, directory groups, file rows) · center diff (file path, Unified/Split, Open in Rider, hunks with In-commit checkboxes) · right Commit panel (local) or commit details (commit mode). (F-15, F-16)
- States: nothing to commit ("Working tree clean."), merge/rebase in progress (banner "A merge is in progress. Finish or abort it in Rider or git first." / "A rebase is in progress. …", commit disabled with that reason), commit hook failure ("Commit failed. A hook rejected it." with the hook output in a collapsible block "Hook output"; the message is kept), push done ("Pushed to origin/<branch>." in the green block), push rejected ("Push rejected: the remote has commits you don't have." with a link "Pull with rebase in Rider" that opens Rider; the app does not auto-rebase), Claude usage limit ("Claude usage limit reached" with the reset time under Suggest, F-18.7; the message is kept).
- No repository yet (M1, until F-19.6 in M2): "Pick a repository" with a folder dialog; the picked folder becomes the default repository and the title bar shows its name as text.
- Local mode shows the diff HEAD → working tree; the checkboxes show the index (`05` › Local diff). If the staged version of a hunk's lines differs from the file (staged, then edited again), the hunk header adds a muted note "The staged version of these lines differs from the file." Untracked files are NEW; a rename shows as RENAMED once it is staged (before that git reports DELETED + NEW). Binary files have only the file checkbox and the text "Binary file. Not shown." Shift+click on a line number toggles that one line in the index; a hunk checkbox is tri-state like the directories.
- The filter count shows the number of matching files while the filter is not empty, otherwise the number of files (the mock always shows the total).
- Commit mode opens HEAD unless a commit is given (the route's `commit`, from Browse files in M2); the toggle reads "Commit <short sha>". **Amend previous commit** fills an empty message with the previous commit's message; text the user typed is never overwritten.
- MR browse (route `sessionId`, from **Browse files instead** on S-02, F-06.11): read-only files of a teammate's MR session (merge base → head). The toggle reads "Local changes" / "MR !482"; no checkboxes; the right aside shows the MR title, author · age, `source → target`, `N files +add −del · N commits`. **Open in Rider** opens the file from the folder `rider.openFrom` picks (F-24.1). **Show** on the S-02 Skim row (F-06.6) opens the same browse with only that row's files; the tree then says "5 of 16 files" instead of "16 files", and **Browse files instead** lists the whole change again.
- After a commit the tree shows the real index (the committed-state PNG still shows "80 of 100 in commit"; that's a mock inconsistency). **Push and create MR** pushes, then opens S-11.
- **Review step by step** (commit mode) and **Review with Claude first** need review sessions: static placeholders until M3.
- Data: `git.status`, `git.diff(path)`, `git.stage(hunks|lines)`, `git.unstage`, `git.commit(message, amend)`, `git.push`, `claude.commit_message()`.

## S-07 Settings
- Mock: `Settings.dc.html` (prop/state `section`) · Screens: `S07-settings-<section>.png` for general, claude, gitlab, integrations, notifications, rules, shortcuts
- Entry: Settings tile, `Ctrl+,`, model chip (opens Claude), tray gear (opens Notifications).
- Regions: section nav (purple active item, badge "1" on Team rules when a suggestion waits) · section content (max width 900px). (F-18, F-19, F-24, F-28, F-29, F-23.5)
- Changes save immediately (no Save button); invalid values show inline errors.
- Rows the mock doesn't show (built with the existing row styles: label left, control right):
  - General: "Keep running in the tray when closed" (switch, F-28.1).
  - Claude: "Claude Code" executable (path · version, **Change**) and "Run at most N Claude tasks at once" (segmented 1–4) (F-18.6); the "Writes in" hint reads "Notes, suggested comments, commit messages, MR descriptions". The status line under the heading: "Claude Code: signed in" (green square), "Claude Code: not signed in" (orange square, **Sign in to Claude Code**), "Claude Code: not found" (orange square, **Change**), "Guided Review needs Claude Code 2.1.248 or later." (orange square), "Claude usage limit reached" with the reset time (orange square, F-18.7).
  - Model chips (F-18.5) with "Same as Claude Code" read "Claude Code default · <effort>".
- Until their milestones the other sections are stubs and the Team rules badge is hidden.
  - GitLab: unconfigured state (Server URL, token input, **Check and save**), **Replace token**, **Remove**; repositories with **Add repository**, **Set as default**, **Remove** and the worktree folder per repository (F-19.5, F-19.6). The token is shown only as `glpat-…3f9a`. Status line under the heading: "Signed in as bartek.k on gitlab.local" (green square), "Add your GitLab token" (orange square, no token), the problem's message (orange square, failing check). Expiry reads "expires in N days" / "expires in 1 day" / "expires today" / "expired" / "no expiry". **Replace token** opens the token form with the server filled in and a **Cancel** button. The worktree folder is shown, not edited.
  - Integrations (F-24.4): Rider found → "Found 2026.2" (major.minor of `product-info.json`, green square); not detected → "Not found" (orange square) in the heading and the Path row, with **Change**. "From Rider to this app" and "Code navigation" come with their milestones.
  - Notifications: quiet hours from/to time inputs and a Weekends switch (F-28.5).
  - Shortcuts: every shortcut of F-30.6, grouped Review · Code · App (F-19.3); each row's keys can be changed, with **Reset** per changed row and **Reset all** (F-19.7).

## S-08 Pipeline
- Mock: `Pipeline.dc.html` · Screens: `S08-pipeline.png`, `S08-pipeline-manual-job.png`, `S08-pipeline-running.png`, `S08-pipeline-old-failed.png`
- Entry: any pipeline status link, tray "Pipeline …".
- Regions: back link, heading "PIPELINE" + status block + allowed-failure tag, meta line, actions (Retry failed jobs / Cancel pipeline, Open in GitLab, **Run new pipeline**) · confirmation strip · pipeline tabs · stage columns · job details panel (log left; "Why it failed" / artifacts / running status right; or the manual-job form). (F-20)
- States: no pipelines ("No pipeline for this MR yet." + Run new pipeline); insufficient permission (actions disabled with tooltip from GitLab's 403 message); log too long (show the last 500 lines, "Full log" opens it in the browser).
- A manual job's ▶ in its row only selects the job; the job plays only from the form's **Run `<job>`** (F-20.2, F-20.6, T7). The description line is hidden when GitLab provides none.
- Title bar model chip = MR & pipeline task (the mock's "Sonnet 5.5 · medium" is example data).
- Data: `gitlab.mr_pipelines`, `gitlab.pipeline_jobs`, `gitlab.job_trace` (polling while running), `gitlab.create_mr_pipeline`, `gitlab.play_job(vars)`, `gitlab.retry_job`, `gitlab.cancel_job`, `gitlab.retry_pipeline`, `gitlab.cancel_pipeline`, `claude.explain_job(job)`.

## S-09 Since your last review
- Mock: `Rereview.dc.html` · Screens: `S09-since-last-review.png`, `S09-since-last-review-new-commit.png`
- Regions: left panel (label "SINCE YOUR LAST REVIEW", heading "N CHANGES TO CHECK", who/when, **Review N changes**, Review everything again, Compare control, Commits in this MR, rebase noise row) · main (commit tag + SHAs, commit title, Claude summary, split diff "Version 2 · your review" vs "Version 3 · now", "Your review so far" tiles and outdated-draft card). (F-21)
- Entry: **Only new changes** on a resume card (S-01, F-04.2); **See what changed** on the new-version strip of an open MR session (below); a tray toast from M10 (until then the route exists and nothing in the tray links to it).
- Data: `gitlab.mr_versions`, `git.range_diff(old, new)`, `git.interdiff(commit_pair)`, `claude.rereview_summary`.
- Words used below (rules in `05` › Re-review): **your version** = the MR version the session last reviewed (`v2` in the mock); **latest** = the newest version (`v3`); a **change** = a commit tagged Changed or New; **N** = their count. Strings are written in sentence case; condensed elements uppercase them with CSS. `<age>` follows `03` › Copy style ("40 min ago").

**States and copy (S-09).** Everything here is decided (M8 spec, `docs/process/DECISIONS-PENDING.md` D-84); a state not listed is a gap to report, not to invent.

| State | When | Left panel | Main | Actions and keys |
| - | - | - | - | - |
| Loading | on open, while versions, fetch and range-diff run | label, "Comparing v2 with v3…" with a spinner and **Cancel** | empty | **Cancel** returns to the screen S-09 was opened from |
| Changes to check | N ≥ 1 | label "Since your last review"; heading "3 changes to check" ("1 change to check"); who/when line (next row); **Review 3 changes** ("Review 1 change") with the `Enter` key cap; **Review everything again**; "Compare"; "Commits in this MR"; rebase row | the first change (Changed or New) is selected | `Enter` = **Review N changes**, except when focus is in a text field or on another button; commits list is a listbox (`↑`/`↓` select); Compare chips are a radio group (`←`/`→`) |
| Who/when line | always with the heading | rebased (base moved): "Ola M. force-pushed 40 min ago and rebased onto develop."; force-push on the same base: "Ola M. force-pushed 40 min ago."; new commits on top of your version: "Ola M. pushed 2 new commits 40 min ago." ("1 new commit") | | name = the MR author as thread cards show names; age = the latest version's `created_at` |
| Compare control | always | chips `v1` … `v<n-1>`, the "you" tag on your version, an arrow, `v<n> · latest` (not selectable); chips wrap to a second row when they don't fit | | default "from" = your version; picking another chip recomputes the screen for that pair (loading line in place of the commits list: "Comparing v1 with v3…") |
| Your version unknown | the session's head SHA is not one of the MR's versions | no "you" tag; line under Compare: "Your review was on a1b2c3d, which isn't one of the MR's versions. Comparing with v2." | as Changes to check | default "from" = the version before the latest |
| Commit rows | in the commits list | tag + title + meta: Same "patch identical after rebase"; Changed "2 hunks changed" ("1 hunk changed"); New "new commit · +9 −2" ("−0" omitted); Dropped "removed from the branch", title struck through. Same and Dropped titles use the dim text colour. Order: the latest version's commit order, Dropped rows last | | accessible name "Changed: Show errors under fields, 2 hunks changed" (the tag is a word, never colour only) |
| Selected Changed | a Changed row is selected | | tag, "a90c2e1 → 3fd6b08", commit title, summary box, split diff of the author's change in that commit (rebase noise removed), one block per file with the path and hunk headers; column headers "Version 2 · your review" (your version) or "Version 1" (another "from"), and "Version 3 · now" | |
| Selected New | a New row is selected | | tag, "— → 7e5c19a", title, summary box, split diff of the commit against its parent (left column empty for added lines) | |
| Selected Same | a Same row is selected | | tag square + "Same patch as in v2, only rebased. Your review of it still holds." (from = your version) or "Same patch as in v1, only rebased." (another "from"); no summary box, no diff | |
| Selected Dropped | a Dropped row is selected | | tag square + "Removed from the branch. Nothing to review." | |
| Replay conflict | a Changed commit can't be replayed on the new base (`05`) | | line above the diff: "Couldn't replay this commit on the new base, so this shows git's comparison of the two patches." and range-diff's patch comparison in mono | |
| Summary box, no result yet | Changed or New selected, no cached summary for this pair of versions | | purple square, "Claude can summarize what changed in each commit and check your drafts on changed code.", **Summarize with Claude** | one click runs the re-review task once for every change and draft of this pair (`05` › Claude tasks); Claude never runs by itself here (owner direction 2026-10-14) |
| Summary running | after the click | | "Claude is writing a summary…" in every summary box and on the draft cards | the F-18.8 title-bar spinner runs |
| Summary ready | result stored | | the commit's paragraph after the purple square (mock); cached per pair of versions, shown at once on reopen | |
| Summary failed | the task failed | | "Couldn't summarize the changes." + **Retry**; usage limit: "Claude usage limit reached" (+ " · resets 15:32" when known, F-18.7) | |
| Claude unavailable | F-18.1 status is not "signed in" | | **Summarize with Claude** disabled; tooltip = the F-18.1 status ("Claude Code: not signed in", "Claude Code: not found") | |
| Rebase row | only when the base moved | hidden (default): "Rebase brought 14 commits from develop. Hidden: they aren't part of this MR." + **Show**; shown: "Rebase brought 14 commits from develop (31 files). Shown greyed out in the diff." + **Hide** ("1 commit", "1 file") | shown: lines of the selected commit that came from the target are greyed out (`05`) | not kept after leaving the screen |
| Your review so far | from = your version | | tiles "4 steps still valid" (green number) and "1 step to look at again" (orange number), singular "1 step …"; counted over the steps you had marked reviewed | when you had marked none: one line "You hadn't marked any step reviewed in v2." instead of the tiles |
| Your review so far, other "from" | from ≠ your version | | the section and the draft cards are hidden (they describe your review) | |
| Draft on changed code | one card per unpublished draft of yours whose line is on code that changed (`05`) | | "Draft on code that changed:" + "“<the draft's first line>”" (ellipsis when longer); after the summary run a purple line: "Claude: fixed in v3. <why>", "Claude: still applies in v3. <why>" or "Claude: can't tell. <why>"; before it, **Check with Claude** on the card (the same single task as **Summarize with Claude**); more than 3 cards: the first 3 and **Show 2 more drafts** | **Drop draft** (yellow) → "Draft dropped." + **Undo**; **Keep** → "Kept. It moves to the new line." + **Undo**, or "Kept. Its line is gone, so it moves to the top of the file." when the line text is not found (F-11.3 placement); **Undo** works until you leave S-09; Drop and Keep are stored at once |
| Nothing but a rebase | N = 0 and nothing dropped | heading "Nothing to check"; "Nothing changed except the rebase. Your review still holds."; **Approve** (green, the S-05 approve action: sends the latest head SHA, F-14) and **Continue**; commits list (all Same) and rebase row | the first commit selected (Same text) | no key approves; `Enter` does nothing here |
| Only removed commits | N = 0, at least one Dropped | heading "Nothing to check"; "Only commits were removed since your review. Your review still holds for the rest."; **Approve** and **Continue** | the first Dropped commit selected | as above |
| Commits can't be paired | range-diff pairs nothing (`05`) | heading "4 files to check" ("1 file to check"), **Review 4 files**; under Compare: "Git couldn't pair the commits of v2 and v3 (the history was rewritten), so this shows every change between them."; the commits list has one row: tag Changed, "All changes since v2", meta "4 files · 7 hunks changed" | that row selected: summary box and split diff of the whole author's change | **Review 4 files** makes one step per file |
| No newer version | opened when your version is the latest | heading "Nothing new"; "You've already reviewed the latest version (v3)."; **Continue** | empty | |
| GitLab unreachable | versions request fails without an answer | "Couldn't reach GitLab." + **Retry** | empty | |
| GitLab refused | 4xx answer | "Couldn't load the MR versions. <reason>" + **Retry** (reason = GitLab's message in plain words, as M6 decision 8) | empty | |
| Your version's commits gone | the old head can't be fetched (`05`) | "Couldn't load v2: its commits are no longer on this computer or in GitLab." + **Review everything again** | empty | |
| git failed | range-diff or replay exits with an error | "Couldn't compare the versions. <reason>" + **Retry** | empty | |
| After a restart | S-09 was the last screen | as on open: default "from", the first change selected | | Drop/Keep results and summaries are stored; selection, "from" and Show/Hide are not |

Accessibility: busy lines are `role="status"`, failure lines `role="alert"`; the heading is the page's `h1`; Dropped rows say "Dropped" in their accessible name (strike-through is not the only signal).

**What the two buttons do (F-21.8).**
- **Review N changes** continues the same MR session (one resume card per MR): one step per change in the commits list order; step title = the commit subject; description = the cached summary, else "2 hunks changed since v2." / "New commit since v2."; the step's hunks are the author's change (`05` › Re-review; the coverage invariant holds over them). Steps "to look at again" lose their reviewed mark; steps "still valid" keep it. The session's version becomes the latest (the "you" tag moves). It opens step 1 in the mode last used (Focus or Detailed). Drafts stay. The S-01 card then reads "Since v2 · 1 of 3 steps · 2 drafts".
- **Review everything again** continues the same session with the normal plan (S-02) for the latest version, as when an MR is opened; every reviewed mark is cleared; drafts stay. The session's version becomes the latest.

**New-version strip (F-21.1, in S-02, S-03, S-04 and S-05 of an MR session).** When the session sees a newer MR version (on window focus and on the F-02.4 refresh timer), a strip at the top of the main column says "Ola M. pushed a new version (v3) since you started." with **See what changed** (opens S-09) and **Later** (hides the strip until the next version). The app never switches to S-09 by itself: the user may be in the middle of a step.

## S-10 Your MR (author mode)
- Mock: `Author.dc.html` · Screens: `S10-author.png`, `S10-author-fix-proposed.png`, `S10-author-committed.png`, `S10-author-pushed.png`, `S10-author-question.png`
- Regions: left (label, heading, branch, thread list, resolved summary, safety note) · main (sticky file bar with Open in Rider · line N, unified diff, thread card at its line with actions or proposal, commit/push panel at the bottom). (F-26, F-25)
- States: working tree dirty with unrelated changes → warn before Fix ("You have other uncommitted changes. They won't be part of this commit." with Stash link); branch behind remote → "Pull first" before push; push failed → reply stays queued with Retry; checkout not on the MR's source branch → read-only (F-26.8).
- Thread status tags use the severity colors: Question is blue (the mock's orange is wrong), Change requested orange, Fix proposed purple, Fixed locally yellow, Resolved green.
- Copy follows F-26.4, F-26.6 and F-26.7 (no pronouns guessed from names).
- Data: `gitlab.discussions(mine)`, `git.diff(worktree=own checkout)`, `claude.fix(thread)`, `fs.watch(file)`, `git.commit(fixup)`, `git.push`, `gitlab.reply`, `gitlab.resolve`, `claude.reply_draft(thread)`.

## S-11 New merge request
- Mock: `CreateMR.dc.html` · Screens: `S11-create-mr.png`, `S11-create-mr-created.png`
- Regions: main (heading, branch row with target select and stats, Title, Description with Claude label and regenerate button, options as checkboxes) · aside (Reviewers with suggestions and search, Before you create checks, **Create merge request** with notify note; the button reads **Create draft MR** when Mark as draft is on). (F-27)
- States: branch not pushed → first check orange with **Push now**; an MR for this branch already exists → banner with link, Create disabled.
- Data: `git.branch_info`, `git.merge_tree(target)`, `claude.mr_description`, `reviewers.suggest(paths)`, `gitlab.users_search`, `gitlab.create_mr`.

## S-12 Code navigation (capability inside S-03/S-04)
- Mock: `Navigate.dc.html` · Screens: `S12-navigation-hover-usages.png`, `S12-navigation-peek.png`, `S12-navigation-moved-expanded.png`
- Not a separate route: hover card, peek panel and usages side panel appear inside step review (Focus and Detailed). The mock also shows the moved-code row (F-22). (F-23)
- The title bar is the step-review title bar (S-03/S-04), including the layout switcher in Focus; the Navigate mock omits it.
- States: index building ("Indexing mobile-app · 40%"), index failed (fallback to symbols with a note), symbol not resolved ("No definition found").
- Data: `nav.hover(file, line, col)`, `nav.definition`, `nav.usages` (+ MR membership computed in the core), `claude.usages_insight` (optional).

**Moved rows (F-22, M8; in S-03 layouts A, B, C and S-04).** Mock state `{"moved":true,"hover":false}` (`S12-navigation-moved-expanded.png`). Detection rules in `05` › Moved code. Decided in D-84.

| State | What shows | Copy | Actions |
| - | - | - | - |
| Destination, collapsed (default) | one row in place of the moved added lines: tag MOVED, origin, change tag, buttons right | "16 lines from ViewModels/DeliveryPhotoViewModel.cs L88–103"; the path is its last two segments (full path in the tooltip and the accessible name); moved within the same file: "16 lines from L88–103"; tag "1 line changed" / "2 lines changed" (orange) only when lines changed | **Show**, **Go to origin** |
| Destination, expanded | the row stays as a header; the block's lines below it: unchanged moved lines dimmed, no `+` sign, line numbers kept; each changed line as a normal `−`/`+` pair | when the block has changed lines: its first 5 lines, each changed pair and the 2 lines after it stay; every other unchanged run folds into one row "8 more unchanged lines" (click unfolds; no `//`, so it reads right in XAML and resx too); without changed lines all lines show | **Hide**, **Go to origin** |
| Origin (F-22.3) | one row in place of the moved deleted lines | "Moved to Workers/UploadWorker.cs L44–59" (same file: "Moved to L44–59"); tag "1 line changed" as above | **Show** (the deleted lines dimmed, changed ones as `−`), **Go to destination** |
| Go to origin / destination | the other end is in the same step: scroll to it and focus its row; in another step or skim group: open that step or group at that line in the same mode; reviewed marks don't change | | |
| Note, thread or draft inside | a note card, thread card, draft or the focused gutter marker sits on a line of the block | the block starts expanded | **Hide** works as usual |
| Split view | the collapsed row spans both columns; expanded: moved lines in the right column (destination) or left column (origin), changed lines as a pair across the columns | | |
| Restart | expanded blocks are not stored: every block starts collapsed (except the row above) | | |
| Other screens | S-06, S-09 and S-10 show plain diffs in M8 (staging in S-06 works on lines; S-09 shows the author's change only) | | |

Accessibility: **Show**/**Hide** carry `aria-expanded`; the row's accessible name is "Moved: 16 lines from src/App/ViewModels/DeliveryPhotoViewModel.cs lines 88 to 103, 1 line changed"; dimmed lines carry the screen-reader text "moved, unchanged" (dimming is not the only signal); the F-30.6 arrow-key walk skips folded lines.

## S-13 Tray and notifications
- Mock: `Tray.dc.html` · Screen: `S13-tray.png` (two crops of the desktop: toasts and tray menu; the captions are Polish documentation, not UI)
- Native parts: Windows toasts (via the notification plugin or the Windows API, see `05`) and a custom small window for the tray menu (frameless, 410px wide, anchored above the tray icon). (F-28)
- Toasts are native: only their title, body and button texts are spec; the mock's yellow buttons are illustration.

## Documentation boards
- `Flow.dc.html` → `D01-flow.png`: the six phases (Source, Preparation, Plan, Step by step, Decisions, Output) × lanes (You, App, Claude, GitLab · git). Polish.
- `Architecture.dc.html` → `D02-architecture.png`: component diagram. Polish.
