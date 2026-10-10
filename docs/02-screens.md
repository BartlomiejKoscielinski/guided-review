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
  2. "Pick up where you left off": resume cards (F-04)
  3. Three columns: **Merge requests** (blue header, tabs, rows; F-02), **Commits** (white header, search, selectable list, Review/Browse; F-03), **My changes** (green header, scope radios, Review before push / Browse and commit; F-03)
- States: GitLab not configured → Merge requests column shows "Add your GitLab token" with a button to S-07 › GitLab; repository not a git repo → My changes column shows "Pick a repository" (folder dialog); empty tabs → "Nothing waiting for you." etc.; loading → 3 skeleton rows.
- Data: `gitlab.list_mrs(tab)`, `sessions.list_unfinished()`, `git.log(branch, query)`, `git.status_summary(scope)`, `app.health()`.

## S-02 Review plan
- Mock: `Overview.dc.html` · Screen: `S02-plan.png`
- Entry: MR row, `Start` with MR input, `guidedreview://mr/<iid>`, tray.
- Regions: header (title, meta, actions) · left: "What this change does", plan list with strategy toggle, Skim row · right aside: Risks to check (app-generated config-change risks first, F-06.13), MR description vs code, Already discussed, Coverage. (F-06)
- A step's reason doesn't change with the strategy (the mock's alternative reason for step 8 under Tests first is ignored).
- States:
  - Preparing (F-05): heading shows the MR title, the plan area shows progress lines ("Fetching !482", "Creating worktree", "Computing diff · 16 files"), Cancel.
  - Planning: deterministic data (files, hunks, layers, skim, coverage numbers) is shown immediately; Claude sections show a calm placeholder "Claude is planning · usually under a minute" and fill in when the result arrives.
  - Claude failed or not signed in: plan falls back to **File order** grouped by layer, with a banner "Claude isn't available. You can review in file order." and Retry.
  - Cached: everything appears at once; status shows "Plan from cache · <age>".
- Data: `review.open_mr(iid)` (session + preparation events), `claude.plan(session)` (channel), `gitlab.mr_detail`, `gitlab.discussions`.

## S-03 Step review · Focus mode (layouts A, B, C)
- Mock: `Review.dc.html` · Screens: `S03-focus-layout-A.png`, `S03-focus-layout-B.png`, `S03-focus-layout-C.png`
- Entry: Start step 1 (S-02), Continue (S-01), step chips.
- Layout A "Sidebar" (`Ctrl+1`): steps list left with short titles (done = green check square, current = yellow row, others numbered), "Skim · N files" at its bottom; main column: "STEP 4 OF 8", title (34px condensed), description, **Mark reviewed** (neutral button in A, as in the mock; yellow in B and C) + next arrow; file header; diff; inline note and thread cards.
- Layout B "Minimal" (`Ctrl+2`): no sidebar; 8 progress segments in the title bar; floating toolbar centered at the bottom (prev, "Step 4 of 8", next, **Mark reviewed**, **Ask Claude**).
- Layout C "Guide" (`Ctrl+3`): diff left; guide panel right (progress segments, step title and description, "WORTH A LOOK" numbered notes with the focused one expanded, "+1 minor", large **Mark reviewed**, "Ask Claude about this step…" input). Gutter markers are numbered.
- States: step analysis pending → notes area says "Claude is reading this step…" with spinner, diff fully usable; analysis failed → "Couldn't analyze this step." Retry; no notes → "Nothing stood out. Read it yourself, though." (no fake praise).
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
- **Self-review summary** (F-17.4): same layout and drafts list styling, no Publish, no Threads tab, no Approval tile; notes kept "to fix" with **Copy as checklist** (and Fix with Claude per item from M7).
- Data: `drafts.list(session)`, `drafts.update`, `gitlab.publish_drafts(session, ids, summary?)`, `gitlab.discussions`, `gitlab.resolve(discussion, bool)`, `gitlab.approve(sha)`, `gitlab.unapprove()`, `gitlab.approval_state()`.

## S-06 Changes and commit
- Mock: `Changes.dc.html` · Screens: `S06-changes-local.png`, `S06-changes-commit.png`, `S06-changes-committed.png`
- Entry: Changes tile, Browse files (S-01, S-02), Browse and commit.
- Regions: left tree panel (source toggle, filter, master checkbox, directory groups, file rows) · center diff (file path, Unified/Split, Open in Rider, hunks with In-commit checkboxes) · right Commit panel (local) or commit details (commit mode). (F-15, F-16)
- States: nothing to commit ("Working tree clean."), merge/rebase in progress (banner, commit disabled with reason), commit hook failure (show hook output in a collapsible block, keep the message), push rejected (offer "Pull with rebase" link to open Rider; the app does not auto-rebase).
- After a commit the tree shows the real index (the committed-state PNG still shows "80 of 100 in commit"; that's a mock inconsistency).
- Data: `git.status`, `git.diff(path)`, `git.stage(hunks|lines)`, `git.unstage`, `git.commit(message, amend)`, `git.push`, `claude.commit_message()`.

## S-07 Settings
- Mock: `Settings.dc.html` (prop/state `section`) · Screens: `S07-settings-<section>.png` for general, claude, gitlab, integrations, notifications, rules, shortcuts
- Entry: Settings tile, `Ctrl+,`, model chip (opens Claude), tray gear (opens Notifications).
- Regions: section nav (purple active item, badge "1" on Team rules when a suggestion waits) · section content (max width 900px). (F-18, F-19, F-24, F-28, F-29, F-23.5)
- Changes save immediately (no Save button); invalid values show inline errors.
- Rows the mock doesn't show (built with the existing row styles: label left, control right):
  - General: "Keep running in the tray when closed" (switch, F-28.1).
  - Claude: "Claude Code" executable (path · version, **Change**) and "Run at most N Claude tasks at once" (segmented 1–4) (F-18.6); the "Writes in" hint reads "Notes, suggested comments, commit messages, MR descriptions".
  - GitLab: unconfigured state (Server URL, token input, **Check and save**), **Replace token**, **Remove**; repositories with **Add repository**, **Set as default**, **Remove** and the worktree folder per repository (F-19.5, F-19.6). The token is shown only as `glpat-…3f9a`.
  - Notifications: quiet hours from/to time inputs and a Weekends switch (F-28.5).
  - Shortcuts: every shortcut of F-30.6, grouped Review · Code · App (F-19.3).

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
- States: range-diff can't pair commits (history rewritten heavily) → fall back to whole-MR interdiff with a note; only rebase, no author changes → "Nothing changed except the rebase. Your review still holds." + Approve shortcut.
- Data: `gitlab.mr_versions`, `git.range_diff(old, new)`, `git.interdiff(commit_pair)`, `claude.rereview_summary`.

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

## S-13 Tray and notifications
- Mock: `Tray.dc.html` · Screen: `S13-tray.png` (two crops of the desktop: toasts and tray menu; the captions are Polish documentation, not UI)
- Native parts: Windows toasts (via the notification plugin or the Windows API, see `05`) and a custom small window for the tray menu (frameless, 410px wide, anchored above the tray icon). (F-28)
- Toasts are native: only their title, body and button texts are spec; the mock's yellow buttons are illustration.

## Documentation boards
- `Flow.dc.html` → `D01-flow.png`: the six phases (Source, Preparation, Plan, Step by step, Decisions, Output) × lanes (You, App, Claude, GitLab · git). Polish.
- `Architecture.dc.html` → `D02-architecture.png`: component diagram. Polish.
