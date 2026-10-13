# Field visit 2 · checklist

Copy to `field/reports/visit-2-checklist.md` (RUNBOOK-2 step 4) and fill in **Result** with `yes`, `no` or `skip`. **Kind** only when the result isn't `yes`, and only one of: `blocked:smartscreen`, `blocked:policy`, `tls`, `unauthorized`, `forbidden`, `scope`, `expired`, `unreachable`, `count_mismatch`, `rows_mismatch`, `not_found`, `wrong_path`, `wrong_line`, `changed`, `other`. **Seconds** only for D3. No other text: no names, hosts, paths, MR numbers, titles or messages.

| ID | Step | Check | Result | Kind | Seconds |
| - | - | - | - | - | - |
| A1 | 5 | The portable app starts | | | |
| A2 | 5 | Title bar reads "Claude Code signed in" (F-18.1) | | | |
| B1 | 6 | Check and save accepts the token through the internal CA; masked token and expiry shown (F-19.5) | | | |
| B2 | 7 | No `glpat-` in the app's data folders (NFR-04) | | | |
| B3 | 8 | Add repository detects the GitLab project; worktree folder is `<repo parent>\.review` (F-19.6) | | | |
| C1 | 9 | Waiting for me matches the web list (F-02.1) | | | |
| C2 | 9 | Mine matches the web list (F-02.1) | | | |
| C3 | 9 | All open matches the web list (F-02.1) | | | |
| C4 | 9 | Rows show `+add −del`, file count and pipeline like the web (F-02.2) | | | |
| D1 | 10 | Preparing shows Fetching, Creating worktree, Computing diff (F-05.6) | | | |
| D2 | 10 | A worktree appears under the review worktree folder (F-05.1) | | | |
| D3 | 10 | Seconds from Start to the prepared header | | | |
| E1 | 11 | Settings › Integrations reads "Found <version>" with a path (F-24.4) | | | |
| E2 | 11 | Open in Rider opens the file at the hunk's first line (F-24.1) | | | |
| E3 | 11 | With "The review worktree", the file is under the review worktree folder (F-24.1) | | | |
| E4 | 12 | With "My checkout", the file is under the clone (F-24.1) | | | |
| F1 | 13 | The clone is untouched: same branch, no changed or staged files | | | |
