# 05 · Integrations: git, GitLab, Claude Code, code index, Rider, Windows

Rule for this file: anything marked **verify** must be checked against the current documentation (or your GitLab instance's `/help/api/…` pages, which match its version) before you implement it. Record what you found in `08-decisions.md` (Spike notes).

---

## git (CLI, minimum 2.40)

All calls go through `git/runner.rs` with `-c core.quotepath=off -c core.longpaths=true -c color.ui=false`, `LC_ALL=C`, UTF-8 output, `CREATE_NO_WINDOW`. Startup check: `git --version` ≥ 2.40 (needed for `merge-tree --write-tree --merge-base`), else `GIT_TOO_OLD`.

| Purpose | Command |
| - | - |
| Fetch MR head | `git fetch origin +refs/merge-requests/<iid>/head:refs/review/mr/<iid>` and the target branch |
| Review worktree | `git worktree add --detach <path> <head_sha>`; reuse if it exists at the same SHA; remove with `git worktree remove --force <path>` + `git worktree prune` |
| File list + counts | `git diff --name-status -z -M <base> <head>` and `git diff --numstat -z -M <base> <head>` |
| Patch | `git diff --no-color --no-ext-diff -M -U3 <base> <head> [-- <path>]` (`-w` for Ignore whitespace) |
| Commit list | `git log --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI -n 200 <branch> [--grep/--author]` |
| Local status | `git status --porcelain=v2 -z --untracked-files=all` |
| Local diffs | unstaged `git diff`, staged `git diff --cached`, branch `git diff <merge-base>...HEAD` |
| Stage selection | build a patch with only the selected lines (unselected `-` lines become context, unselected `+` lines are dropped) → `git apply --cached --recount -` |
| Unstage selection | same patch → `git apply --cached --reverse --recount -` |
| Commit | `git commit -F <tmpfile> [--amend] [--fixup=<sha>]` (user's hooks run; show their output on failure) |
| Push | `git push origin HEAD` (`-u origin <branch>` when no upstream). Never force-push. |
| Conflict check | `git merge-tree --write-tree --no-messages --name-only <target> HEAD` → exit 1 = conflicts, list files |
| Range-diff | `git range-diff --no-color <old_base>..<old_head> <new_base>..<new_head>` |
| Replay old commit on new parent | `git merge-tree --write-tree --merge-base=<old_commit>^ <new_commit>^ <old_commit>` → tree T; author's real change = `git diff T <new_commit>` |
| Blame for reviewer suggestions | `git blame --line-porcelain -w -M -L <a>,<b> <base> -- <file>` for changed old ranges |

### Diff parsing
Parse unified diff in Rust (`git/diff.rs`): file headers (incl. rename/copy, binary, mode changes), hunk headers with function context, `\ No newline at end of file`. Compute intraline emphasis per modified line pair with `similar` (word level, fall back to char level for short lines). Pair `-`/`+` runs inside a hunk by position for split view.

### Range-diff parsing
Line format: `<n>:  <sha> <op> <m>:  <sha> <subject>` where `op` is `=` (same), `!` (changed), `<` (only in old = dropped), `>` (only in new = new); `-` and `-------` mark the missing side. Regex: `^\s*(\d+|-):\s+([0-9a-f]+|-+)\s+([=!<>])\s+(\d+|-):\s+([0-9a-f]+|-+)\s+(.*)$`. Indented lines after a `!` entry are the patch-diff; keep them as a fallback view when the replay above conflicts.

### Moved code (own algorithm, git as test oracle)
`git diff --color-moved` cannot report "moved with a small change", so the core implements detection itself (`git/moved.rs`):
1. Collect runs of deleted lines and added lines across all files of the diff.
2. Normalize lines (trim, collapse inner whitespace); ignore blank lines and lines that are only braces.
3. Find matching blocks between a deleted run and an added run: at least 3 lines and 20 alphanumeric characters (git's threshold), allowing up to 2 modified lines inside when the block is ≥ 8 lines.
4. Mark lines with `MovedRef { block_id, origin_file, origin_range, changed_lines }`.
5. Test oracle: for blocks without changes, results must match `git -c color.diff.oldMoved=… -c color.diff.newMoved=… diff --color=always --color-moved=blocks --color-moved-ws=allow-indentation-change` on the fixture repos.

---

## GitLab REST API v4

Base: `https://<host>/api/v4`. Auth header `PRIVATE-TOKEN: <token>` (personal access token with scope `api`, stored in Windows Credential Manager). TLS must trust the **Windows certificate store** (internal CA). Paginate with `per_page=100` and the `x-next-page` header. On 429 respect `Retry-After`. Map 401 → `GITLAB_UNAUTHORIZED`, 403 → `GITLAB_FORBIDDEN` (show GitLab's message), 404 → `GITLAB_NOT_FOUND`.

`:id` = URL-encoded project path (`mobile%2Fmobile-app`) or numeric id. `:iid` = MR number.

| Feature | Method and path | Status |
| - | - | - |
| Current user | `GET /user` | standard |
| MR lists | `GET /projects/:id/merge_requests?state=opened&reviewer_username=<me>` · `…&author_username=<me>` · `…&state=opened` | standard, **verify** reviewer filter on your version |
| MR detail (incl. `diff_refs`: base/start/head SHA) | `GET /projects/:id/merge_requests/:iid` | standard |
| MR versions | `GET /projects/:id/merge_requests/:iid/versions` and `/versions/:version_id` (fields `head_commit_sha`, `base_commit_sha`, `start_commit_sha`, `created_at`) | standard |
| MRs of a commit | `GET /projects/:id/repository/commits/:sha/merge_requests` | standard |
| Discussions | `GET /projects/:id/merge_requests/:iid/discussions` | standard |
| Reply | `POST /projects/:id/merge_requests/:iid/discussions/:discussion_id/notes` (`body`) | standard |
| Resolve / unresolve | `PUT /projects/:id/merge_requests/:iid/discussions/:discussion_id?resolved=true|false` | standard |
| Draft notes | `POST /projects/:id/merge_requests/:iid/draft_notes` (`note`, `position[…]`, optional `in_reply_to_discussion_id`) | **verify** |
| Publish drafts at once | `POST /projects/:id/merge_requests/:iid/draft_notes/bulk_publish` | **verify** |
| Approve / revoke | `POST /projects/:id/merge_requests/:iid/approve` (send `sha` = reviewed head) · `POST …/unapprove` | standard |
| Approval state | `GET /projects/:id/merge_requests/:iid/approvals` | standard, **verify** fields on your tier |
| Create MR | `POST /projects/:id/merge_requests` (`source_branch`, `target_branch`, `title`, `description`, `reviewer_ids`, `remove_source_branch`, `squash`, `labels`; draft via `Draft:` title prefix or `draft` field) | standard, **verify** `draft` |
| Users for reviewers | `GET /projects/:id/members/all?query=<text>` | standard |
| MR pipelines | `GET /projects/:id/merge_requests/:iid/pipelines` | verified (python-gitlab docs) |
| New MR pipeline | `POST /projects/:id/merge_requests/:iid/pipelines` | verified (GitLab MR !16148) |
| Pipeline jobs | `GET /projects/:id/pipelines/:pipeline_id/jobs` (retried jobs excluded unless `include_retried=true`) | verified (Jobs API docs) |
| Job log | `GET /projects/:id/jobs/:job_id/trace` | verified |
| Play manual job | `POST /projects/:id/jobs/:job_id/play` with `job_variables_attributes: [{key, value}]` | verified |
| Retry job | `POST /projects/:id/jobs/:job_id/retry` | verified |
| Cancel job | `POST /projects/:id/jobs/:job_id/cancel` | verified |
| Retry pipeline (failed/canceled jobs) | `POST /projects/:id/pipelines/:pipeline_id/retry` | verified (Pipelines API docs) |
| Cancel pipeline | `POST /projects/:id/pipelines/:pipeline_id/cancel` | verified |
| Test report | `GET /projects/:id/pipelines/:pipeline_id/test_report` | verified |
| Job artifacts | `GET /projects/:id/jobs/:job_id/artifacts` | standard |

Job statuses to handle: `created`, `pending`, `running`, `success`, `failed` (+ `allow_failure: true`), `canceled`, `skipped`, `manual`, also `waiting_for_resource`, `preparing`, `scheduled` (show as waiting).

### Draft note positions
For a line comment on the reviewed version use the MR's `diff_refs` of that version:
`position[position_type]=text`, `position[base_sha]`, `position[start_sha]`, `position[head_sha]`, `position[old_path]`, `position[new_path]`, and
- added line: `position[new_line]`
- deleted line: `position[old_line]`
- context line: **both** `old_line` and `new_line`.
If the MR got a new version before publishing, re-map positions through the interdiff; drafts whose line no longer exists become general comments with the file:line quoted (ask the user first).

### Polling (tray)
Every N minutes: review-requested list, my MRs (with `updated_after`), MRs I reviewed (versions count changed → "N new commits"), discussions on my MRs (new notes since last seen), latest pipeline on my MRs. Store last-seen markers in `poll_state`. One request burst per interval, no more than ~10 requests.

---

## Claude Code (`claude -p`, user's own login)

The organization has no API key, so the app runs the Claude Code CLI in print mode under the user's Enterprise login. Facts checked in the CLI reference and headless docs (October 2026):

- `--output-format json` returns metadata plus `result`; with `--json-schema '<schema>'` the validated object is in `structured_output`. `--output-format stream-json --verbose --include-partial-messages` streams events; the last line is the `result` message.
- `--resume <session_id>` continues a conversation; capture `session_id` from the JSON result.
- `--model <alias|name>` and `--effort low|medium|high|xhigh|max` (levels depend on the model).
- `--tools "Read,Grep,Glob"` restricts which built-in tools exist; `--allowedTools` only pre-approves.
- `--permission-mode dontAsk` denies anything that would prompt.
- `--setting-sources user` skips project/local settings; `--strict-mcp-config` with no `--mcp-config` loads no MCP servers.
- **Without `--bare`, `-p` runs the hooks in a project's `.claude/settings.json` and connects `.mcp.json` servers, with no trust dialog.** So the flags above are mandatory when working in a teammate's worktree.
- `--bare` would avoid all project config **but does not use the subscription login** (needs `ANTHROPIC_API_KEY`), so it is not an option for us. The docs say bare mode will become the default for `-p` in a future release: pin and check every Claude Code update (see ADR-002 and the startup check below).
- `--restricted` (v2.1.248+) removes command-running tools and loads only managed settings and `--settings`. **Spike (M0):** check whether it works with the Enterprise login; if it does, prefer it for read-only tasks.
- `claude auth status` prints JSON with `authMethod` (`claude.ai` for subscription login).

### Invocation profiles (built only in `claude/runner.rs`)

**Read-only** (plan, step analysis, questions, pipeline explanation, re-review summary, reply draft, MR description, commit message, usages insight):
```
claude -p
  --output-format json  (or stream-json --verbose --include-partial-messages for streaming tasks)
  --json-schema <schema json>                 (structured tasks)
  [--model <m>] [--effort <e>]                (omitted when "Same as Claude Code")
  --tools "Read,Grep,Glob"
  --permission-mode dontAsk
  --setting-sources user
  --strict-mcp-config
  --disallowedTools "mcp__*"
  --append-system-prompt-file <resources/prompts/system-common.md>
  [--no-session-persistence]                  (one-shot tasks; omit where follow-ups are allowed)
  [--resume <claude_session_id>]              (follow-up questions)
cwd   = review worktree (others' MR) or repository root (own code)
stdin = the task prompt (rendered template + inputs as files referenced by path in tmp/)
```

**Fix on own code** (F-25), only when the session source is local or my own MR:
```
same as read-only, plus
  --tools "Read,Grep,Glob,Edit"
  --allowedTools "Edit(<repo-relative path of the one file>)"     (verify rule syntax)
  --permission-mode dontAsk                                      (any other edit is denied)
```
After the process exits the app runs `git status --porcelain=v2` and diffs the working tree against the snapshot taken before; if anything other than that file changed, it restores the snapshot and fails with `CLAUDE_GUARD_VIOLATION`.

### Tasks, models and contracts

| Task | Default model · effort | Prompt | Schema | Streams |
| - | - | - | - | - |
| Review plan | opus · high | `prompts/plan.md` | `schemas/plan.schema.json` | progress only |
| Step analysis | sonnet · medium | `prompts/step.md` | `schemas/step-findings.schema.json` | no |
| Questions | default · low | `prompts/ask.md` | none (text) | yes |
| Fix on own code | sonnet · medium | `prompts/fix.md` | `schemas/fix-result.schema.json` | no |
| MR description | sonnet · low | `prompts/mr-description.md` | `schemas/mr-description.schema.json` | no |
| Pipeline explanation | sonnet · low | `prompts/pipeline-explain.md` | `schemas/pipeline-explain.schema.json` | no |
| Commit message | haiku · low | `prompts/commit-message.md` | `schemas/commit-message.schema.json` | no |
| Re-review summary | sonnet · medium | `prompts/rereview.md` | `schemas/rereview.schema.json` | no |
| Reply draft (author mode) | default · low | `prompts/reply-draft.md` | `schemas/reply-draft.schema.json` | no |
| Rule suggestion | haiku · low | `prompts/rule-suggestion.md` | `schemas/rule-suggestion.schema.json` | no |

The prompts and schemas in `docs/claude/` are the starting point; copy them to `src-tauri/resources/` and bump `prompt_version` whenever you change one (it is part of the cache key). Validate every `structured_output` again in Rust (serde + checks: IDs exist, lines are inside the step) before using it.

### Startup checks
1. `claude --version` → store; if it changed since the last successful probe, run a tiny probe (`claude -p "Reply with OK" --output-format json --tools "" --no-session-persistence --setting-sources user --strict-mcp-config`) and mark Claude as healthy only if `is_error` is false.
2. `claude auth status` → `authMethod` must not be `none` (`CLAUDE_NOT_SIGNED_IN` otherwise).

---

## Code index (S-12)

- Primary: **csharp-ls** (`dotnet tool install --global csharp-ls`), started in the review worktree (or repo root) with the solution: `csharp-ls --solution <path.sln>`, JSON-RPC over stdio. Requests: `initialize`, `textDocument/didOpen`, `textDocument/hover`, `textDocument/definition`, `textDocument/references`. Requires `dotnet restore` to succeed (MAUI workloads installed). **verify** current csharp-ls options.
- Alternative: Roslyn LSP (as used by the C# Dev Kit). Selectable in Settings › Integrations, same client.
- Fallback: tree-sitter index (`tree-sitter-c-sharp`) of declarations; usages by identifier match. The UI says "usages are matched by name".
- Membership: each location is tagged "In this MR · step N" if its file/line falls inside a hunk of the session, else "Outside this MR".
- Navigation works on the new side and context lines. Old-side symbols show the hover from tree-sitter only.

---

## JetBrains Rider

- Detect `rider64.exe`: Settings value → JetBrains Toolbox scripts folder (`%LOCALAPPDATA%\JetBrains\Toolbox\scripts\rider.cmd`) → `C:\Program Files\JetBrains\JetBrains Rider *\bin\rider64.exe` (highest version) → registry App Paths. **verify** on the team's machines.
- Open at line: `rider64.exe --line <n> [--column <c>] <absolute file path>`.
- External Tools: write a tool set "Guided Review" with "Review this branch" (`review --repo "$ProjectFileDir$" --branch current`) and "Review this commit" (`review --repo "$ProjectFileDir$" --commit $SelectedText$`) into Rider's config `tools/External Tools.xml` for each installed Rider version, after backing up the file; ask the user to restart Rider. **verify** the config path and XML format for the installed Rider version before writing.
- The app's own CLI (`GuidedReview.exe review --repo <path> --branch <name>|--commit <sha>`) is forwarded to the running instance by the single-instance plugin.

## Windows integration

- **Deep links** `guidedreview://mr/<iid>?project=<path>`, `guidedreview://commit/<sha>?repo=<path>`, `guidedreview://branch/<name>?repo=<path>`: Tauri deep-link plugin (scheme registered by the installer; `register()` in dev) + single-instance plugin with deep-link support so a running app receives the URL. Validate and whitelist every parameter.
- **Toasts with buttons**: if the notification plugin cannot show action buttons on Windows (**verify**), build toast XML through the Windows API (`windows` crate, `ToastNotificationManager`) with buttons whose `activationType="protocol"` and `arguments="guidedreview://…"`, so a click goes through the deep-link path.
- **Tray**: Tauri tray icon (badge drawn into the icon image), left click toggles a frameless 410px window anchored above the icon, closing on blur.
- **Autostart**: autostart plugin (Settings › General › Start with Windows).
- **Credentials**: `keyring` service `GuidedReview`, account `<gitlab host>`.
- **Installer**: Tauri bundler (NSIS or MSI). Code signing if the company has a certificate.
