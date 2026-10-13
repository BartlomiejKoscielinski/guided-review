# Field visit 2 · runbook (end of M2; runs field visit 1 first)

Checks on the company laptop what M2 can't prove on the development PC (ADR-019, `docs/09-testing.md` › Field kit, `docs/07-roadmap.md` › M2): the S-01 MR lists through **GraphQL** on the on-prem GitLab (ADR-024), and the portable app on real MRs, read-only: token setup through the internal CA, repository, MR lists, fetch and worktree, **Open in Rider**.

- Time: RUNBOOK-1 first (20–30 minutes), then about 25 minutes for the steps below. No Claude calls in this part. About 15 GitLab requests from the probe, all reads; the app reads MR lists and fetches one MR.
- Run by: you. The laptop's Claude Code may run steps 3 and 13 only (rules below).
- What leaves the laptop: `field/reports/visit-1.*`, `field/reports/visit-2.*` (from the probe) and `field/reports/visit-2-checklist.md` (filled in by you). They hold versions, yes/no results, status codes, failure kinds, JSON key sets and types, and timings. Never hostnames, user names, project paths, MR numbers or titles, file names, paths or code (T11).

## Before you start

1. The repository is cloned on the laptop and up to date (`git pull`).
2. `field\bin\` holds **`gr-probe.exe`** and **`GuidedReview.exe`** from the GitHub release **field-visit-2** of this repository (this `gr-probe.exe` replaces visit 1's; it adds the GraphQL checks). Then, in PowerShell in the repository root: `Unblock-File .\field\bin\*.exe`. Both are unsigned; `field\bin\` is not committed.
3. What RUNBOOK-1 needs (VPN, Claude Code signed in, git, the on-prem **sandbox project**, a token with scope `api` and a short expiry), plus: Rider installed, and you can `git clone` the sandbox project with your usual git credentials.
4. Write down for yourself (not in any file of this repository): the GitLab server URL, the sandbox project path, and its clone URL.

## Steps

| # | Who | What | Takes | Checks (checklist IDs) |
| - | - | - | - | - |
| 1 | you | Run **`field/RUNBOOK-1.md` steps 1–7**. Skip its step 8: both visits are committed together in step 15 here. | 20–30 min | S1–S6, S9 on the laptop. Its step 5 (`gitlab read`) already includes the GraphQL checks. |
| 2 | you | In the GitLab web UI, sandbox project › Merge requests › **Closed**: open the `gr-probe/…` merge request that RUNBOOK-1 step 6 closed and click **Reopen**. It is a draft, you are its reviewer, and its approval was revoked. If step 6 made none, create one by hand: new branch, change one line of any file in the web editor, merge request with you as reviewer. | 2 min | an open MR for steps 3, 9–12 |
| 3 | you or Claude Code | `.\field\bin\gr-probe.exe gitlab read --server https://<gitlab host> --project <sandbox path> --report field/reports/visit-2` | 30 s | `graphql.schema` Pass (or the missing names); `graphql.mr_list.waiting/mine/all` Pass; `has_rows` true now that an MR is open; the key set of the app's own list query (ADR-024) |
| 4 | you | `git clone <sandbox clone URL> C:\gr-field\sandbox` (a new folder, only for this visit). Then `Copy-Item field\checklist-2.md field\reports\visit-2-checklist.md` and open the copy: fill in its rows as you go. | 2 min | the checkout the app reviews from; worktrees go to `C:\gr-field\.review` |
| 5 | you | Start `.\field\bin\GuidedReview.exe`. If SmartScreen stops it: **More info** › **Run anyway**. | 1 min | **A1** the app starts (else `blocked:smartscreen` or `blocked:policy`, and skip to step 13); **A2** the title bar chip reads "Claude Code signed in" (F-18.1) |
| 6 | you | Settings (purple tile, or `Ctrl+,`) › **GitLab**: type the server URL, paste the token, **Check and save**. (If a token form isn't shown because one is stored: **Replace token**, paste, **Check and save**.) | 2 min | **B1** F-19.5: green status line "Signed in as … on …", token shown only as prefix + last 4 characters, an expiry text. A failure: its kind only (`tls`, `unauthorized`, `forbidden`, `scope`, `expired`, `unreachable`, `other`), never the message text |
| 7 | you | `Get-ChildItem $env:APPDATA\GuidedReview, $env:APPDATA\com.inpost.guidedreview -Recurse -File -ErrorAction SilentlyContinue \| Select-String -Pattern 'glpat-' -List \| Measure-Object \| Select-Object -ExpandProperty Count` (if your tokens start with another prefix, search that prefix; never type the token itself) | 30 s | **B2** NFR-04: prints `0` |
| 8 | you | Settings › GitLab › **Add repository** › pick `C:\gr-field\sandbox`; **Set as default**. | 1 min | **B3** F-19.6: the GitLab project is detected from `origin`; the worktree folder reads `C:\gr-field\.review` |
| 9 | you | MRs tile (S-01): open **Waiting for me**, **Mine**, **All open** in turn. Next to it, the sandbox's merge request list in the browser, **Open** tab: (a) Reviewer = you, leaving out those you approved; (b) Author = you; (c) no filter. | 3 min | **C1–C3** F-02.1: each tab's count and rows match the web list (`count_mismatch` / `rows_mismatch` if not); **C4** F-02.2: rows show `+add −del`, file count and pipeline as on the web |
| 10 | you | Click the reopened MR's row (or type `!<iid>` in the input, **Start**). Watch Preparing until the prepared header shows, then **Browse files instead**. | 2 min | **D1** F-05.6: Fetching, Creating worktree, Computing diff shown; **D2** F-05.1: a worktree folder appears under `C:\gr-field\.review`; **D3** seconds from Start to the prepared header |
| 11 | you | Settings › **Integrations**: "Teammates' MRs open from" = **The review worktree** (the default). Back in MR browse, pick the changed file, **Open in Rider**. In Rider, hover the editor tab to see the file's path. | 3 min | **E1** F-24.4: the Rider heading reads "Found <version>" with a path; **E2** F-24.1: Rider opens the file at the first line of the shown hunk; **E3** the path is under `C:\gr-field\.review\` |
| 12 | you | Settings › Integrations › **My checkout**; Open in Rider on the same file again; then set it back to **The review worktree**. | 2 min | **E4** F-24.1: this time the path is under `C:\gr-field\sandbox\` |
| 13 | you or Claude Code | `git -C C:\gr-field\sandbox status --short --branch` | 30 s | **F1** still on the branch the clone made, no changed or staged files (an untracked `.idea/` is Rider's own and is fine) |
| 14 | you | Read `field\reports\visit-1.md`, `visit-2.md` and `visit-2-checklist.md`. | 5 min | Nothing in them may identify the company, people, projects or code. If something does, delete it before step 15. |
| 15 | you | `git switch -c field/visit-2`, `git add field/reports/visit-1.* field/reports/visit-2.* field/reports/visit-2-checklist.md`, `git commit -m "M2: field visits 1 and 2 report"`, `git push -u origin field/visit-2` | 1 min | brings the reports back |

If a step fails, record its failure kind in the checklist and go on with the next one.

### Afterwards (optional, on the laptop)
- Close the app. Close the merge request again in the sandbox; delete the `gr-probe/…` branches if you want.
- Remove `C:\gr-field`, and the app's data folders `%APPDATA%\GuidedReview` and `%APPDATA%\com.inpost.guidedreview` (they hold the sandbox's MR titles).
- `.\field\bin\gr-probe.exe token delete --server https://<gitlab host>` removes the token from Credential Manager (the app and the probe share it); revoke the token in GitLab.

## Rules for Claude Code on the laptop
- Run only the commands of steps 3 and 13, from the repository root, exactly as written; plus RUNBOOK-1's own rules for its steps. Ask the user for the GitLab host, the sandbox path and the clone folder; never guess them.
- The app steps (5–12) are the user's: stop and ask the user to do them. Never drive the app, read its data folder, or open files in Rider.
- Never open, read, search or summarize any other repository, file or company code, including `C:\gr-field`. Never copy report contents anywhere but this repository.
- Don't fix or change anything in this repository during the visit; only the report files are committed (step 15, by the user).

## Before the visit (on the development PC)
1. `npm run build:probe` and `npm run build:portable` (`tauri build --no-bundle`: one `GuidedReview.exe` with the UI embedded; no installer, no deep-link registration; it keeps its data in `%APPDATA%` like the installed app). Both land in `src-tauri\target\release\`.
2. Smoke on the PC: copy `GuidedReview.exe` into a folder with spaces and Polish characters, start it, the window shows the app; close it.
3. Probe on the stand-in: `gr-probe gitlab read --server https://localhost:8443 --project sandbox/gr-sandbox --report field/baseline/standin-keysets` keeps the baseline current.
4. Owner: publish the release, e.g. `gh release create field-visit-2 src-tauri/target/release/gr-probe.exe src-tauri/target/release/GuidedReview.exe --prerelease --title "Field visit 2" --notes "Field kit for field/RUNBOOK-2.md"`.

## After the visit (on the development PC)
- Visit 1 results go where RUNBOOK-1 says (spike table in `08`, differences into `05`).
- Compare `graphql.*` in `visit-2.json` (and `visit-1.json`) with `field/baseline/standin-keysets.json`. A missing field falls back to REST for that field only and is recorded in `05` (ADR-024).
- Tick the `[field]` items of `09` › Manual checklist that passed (F-24.1, F-19.5, F-02.1, NFR-04 for the token check); record anything else in `PROGRESS.md`. M2 is done once the report is merged; it gates M3.
