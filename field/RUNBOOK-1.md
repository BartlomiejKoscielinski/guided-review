# Field visit 1 · runbook (end of M2, together with field visit 2)

Checks on the company laptop what the development PC can't prove (ADR-019, `docs/09-testing.md` › Field kit): Claude Code on **Claude Enterprise** (spikes S1–S4, incl. `--restricted`, ADR-022), TLS against the **internal CA** (S6), the **on-prem GitLab** API read and write in a sandbox project (S5), and the **Rider** paths (S9).

- Time: 20–30 minutes. About ten short Claude calls (Haiku), about 40 GitLab requests, of which about 20 writes, only in the sandbox project.
- Run by: you, or the laptop's Claude Code (rules for it below). Steps 3 and 6 are always yours.
- What leaves the laptop: only `field/reports/visit-1.json` and `field/reports/visit-1.md`. They hold versions, yes/no results, status codes, header names, JSON key sets and types, and timings. They never hold hostnames, user names, emails, project paths, code or values: the probe replaces them with placeholders, and refuses to write a report that still contains your GitLab host, user name, email, computer or domain name.

## Before you start

1. The repository is cloned on the laptop and up to date (`git pull`).
2. `gr-probe.exe` (built on the development PC, unsigned) is in `field\bin\`. Download it from the GitHub release **field-visit-1** of this repository. `field\bin\` is not committed.
3. VPN connected; Claude Code signed in with the company account (`claude auth status`); git on PATH.
4. In the on-prem GitLab: a **sandbox project** that you created for this (test branches, MRs, draft notes, approvals and a manual pipeline job are fine there), and a personal access token with scope `api` and a short expiry.

Open PowerShell in the repository root. `.\field\bin\gr-probe.exe` without arguments prints the commands.

## Steps

| # | Who | Command | Takes | Checks |
| - | - | - | - | - |
| 1 | you or Claude Code | `.\field\bin\gr-probe.exe env` | 10 s | Windows build, git, Claude Code path and version (≥ 2.1.248), WebView2, proxy, every Rider install with its config folder (S9) |
| 2 | you or Claude Code | `.\field\bin\gr-probe.exe claude` | 1–2 min | S1–S4 on Enterprise in synthetic repos it creates under `%TEMP%` and removes. If the organization doesn't allow Haiku, add `--model claude-sonnet-5-5`. |
| 3 | **you** | `.\field\bin\gr-probe.exe token set --server https://<gitlab host>` | 1 min | Type the token when asked (hidden). It goes to Windows Credential Manager (`GuidedReview` / `<host>`), the entry the app will use. |
| 4 | you or Claude Code | `.\field\bin\gr-probe.exe tls --server https://<gitlab host>` | 5 s | S6: TLS with the Windows store (the app's choice) and with SChannel; a 401 still proves TLS |
| 5 | you or Claude Code | `.\field\bin\gr-probe.exe gitlab read --server https://<gitlab host> --project <sandbox path>` | 30 s | S5 read: version and edition, token scopes, MR list filters, pagination headers, approvals and job fields. Read-only. |
| 6 | **you** | `.\field\bin\gr-probe.exe gitlab write --server https://<gitlab host> --project <sandbox path>` | 3 min | S5 write, **sandbox only**. It asks `y/N` before each call; answer `y` to run it. See the list below. |
| 7 | you | open `field\reports\visit-1.md` and read it | 5 min | Nothing in it may identify the company, people or code. If something does, delete the line before step 8. |
| 8 | you | `git switch -c field/visit-1`, `git add field/reports/visit-1.*`, `git commit -m "M2: field visit 1 report"`, `git push -u origin field/visit-1` | 1 min | brings the report back |

If a step fails, go on with the next one; the report records the failure kind (for example `tls:unknown_issuer`, `dns`, `status:403`).

### What step 6 writes (sandbox project only)
1. Branch `gr-probe/<time>-base` from the default branch, and a commit with `gr-probe/Sample.cs` (12 synthetic lines) and a `.gitlab-ci.yml` with one **manual** job.
2. Branch `gr-probe/<time>` and a commit that deletes, changes and adds lines in that file.
3. A merge request from the second branch into the first (never into the default branch), marked draft, with you as reviewer.
4. Four draft notes (on an added, a deleted and an unchanged line, and one without a line), published at once; one more draft published together with a summary note.
5. Approve with a wrong SHA (expected to be refused), approve with the right SHA, list checks, revoke the approval.
6. An MR pipeline; the manual job is started with one variable and cancelled right away (it needs no runner until it starts).
7. The merge request is closed. Nothing is deleted: remove the `gr-probe/…` branches in the sandbox afterwards if you want.

## Rules for Claude Code on the laptop
- Run only the commands of steps 1, 2, 4 and 5, from the repository root, exactly as written. Ask the user for the GitLab host and the sandbox path; never guess them.
- Steps 3 and 6 need the user's typing (the token, the `y/N` answers): stop and ask the user to run them in their own terminal.
- Never open, read, search or summarize any other repository, file or company code. Never copy report contents anywhere but this repository.
- Don't fix or change anything in this repository during the visit; only the report files are committed (step 8, by the user).

## After the visit (on the development PC)
The report is merged into `docs/08-decisions.md` (spike table: Laptop/Enterprise results for S1–S6 and S9) and, where it differs from the stand-in, into `docs/05-integrations.md`; GitLab key sets are compared with `field/baseline/standin-keysets.json`.
