# 05 · Integrations: git, GitLab, Claude Code, code index, Rider, Windows

Rule for this file: anything marked **verify** must be checked against the current documentation (or your GitLab instance's `/help/api/…` pages, which match its version) before you implement it. Record what you found in `08-decisions.md` (Spike notes).

---

## git (CLI, minimum 2.40)

All calls go through `git/runner.rs` with `-c core.quotepath=off -c core.longpaths=true -c color.ui=false`, `LC_ALL=C`, UTF-8 output, `CREATE_NO_WINDOW`. Startup check: `git --version` ≥ 2.40 (needed for `merge-tree --write-tree --merge-base`), else `GIT_TOO_OLD`.

| Purpose | Command |
| - | - |
| Fetch MR head | `git fetch origin +refs/merge-requests/<iid>/head:refs/review/mr/<iid>` and the target branch |
| Review worktree | one per MR at `<worktree_root>\<repo>\<iid>`: `git worktree add --detach <path> <head_sha>`; a new version moves it with `git -C <path> checkout --detach <sha>`; remove with `git worktree remove --force <path>` + `git worktree prune`, only for paths registered in `worktrees` |
| Fix scratch worktree (ADR-018) | `git stash create` → SHA (empty output = clean tree, use `HEAD`); `git worktree add --detach <tmp path> <sha>`; after the run `git -C <tmp path> status --porcelain=v2 -z` + `git -C <tmp path> diff`; then remove it. The user's checkout is never touched by this |
| File list + counts | `git diff --name-status -z -M <base> <head>` and `git diff --numstat -z -M <base> <head>` |
| Patch | `git diff --no-color --no-ext-diff -M -U3 <base> <head> [-- <path>]` (`-w` for Ignore whitespace) |
| Commit list | `git log --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI -n 200 <branch> [--grep/--author]` |
| Local status | `git status --porcelain=v2 -z --untracked-files=all` |
| Local diffs | unstaged `git diff`, staged `git diff --cached`, branch `git diff <merge-base>...HEAD` |
| Local diff shown in S-06 | `git diff HEAD` (H→W) is displayed; each line's "in commit" state comes from the index: a `-` line (HEAD line number) is staged when `git diff --cached` (H→I) deletes it, a `+` line (working-tree line number) is staged when `git diff` (I→W) doesn't add it (ADR-008) |
| Stage selection | from the unstaged diff (I→W): build a patch with only the selected lines (unselected `-` lines become context, unselected `+` lines are dropped) → `git apply --cached --recount -`. Untracked files: whole file `git add -- <path>`, lines after `git add -N -- <path>` |
| Unstage selection | from the staged diff (H→I), with the rules mirrored because the patch is applied in reverse (unselected `+` lines become context, unselected `-` lines are dropped) → `git apply --cached --reverse --recount -`. A whole new file: `git restore --staged -- <path>` (index only) |
| Stage or unstage many files | `git add -A --pathspec-from-file=- --pathspec-file-nul` / `git restore --staged --pathspec-from-file=- --pathspec-file-nul` (paths on stdin; the command line stays under the 32k limit) |
| Commit | `git commit -F - [--amend] [--fixup=<sha>]` with the message on stdin (user's hooks run; show their output on failure) |
| Push | `git push origin HEAD` (`-u origin <branch>` when no upstream). Never force-push. |
| Commit details (S-06 commit mode) | `git show -s --format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%b <sha>`; its files `git diff -M <first parent or empty tree> <sha>` |
| Merge or rebase in progress | `.git/MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` in `git rev-parse --git-dir` |
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

During development the same client talks to the **stand-in GitLab** (GitLab EE 17.11.7-ee in Docker on the PC, the on-prem version, ADR-019); only the server URL differs. Differences between the stand-in (Free tier, default instance settings) and the on-prem instance are recorded in the field visit reports and, where they matter, in this table.

| Feature | Method and path | Status |
| - | - | - |
| Version | `GET /version` | standard (needs auth; a 401 still proves TLS) |
| Current user | `GET /user` | standard |
| Token check (F-19.5) | `GET /personal_access_tokens/self` (scopes, `expires_at`) | verified on 17.11.7 (S5) |
| MR lists (F-02.1, F-02.2; ADR-024) | **GraphQL** `POST /api/graphql`, `gitlab/queries/mr_list.graphql`: `project(fullPath).mergeRequests(state: opened, reviewerUsername: <me>, not: {approvedBy: [<me>]})` · `…(authorUsername: <me>)` · `…(state: opened)`, `sort: UPDATED_DESC`, `first: 100` + `pageInfo.endCursor`; fields `iid title draft webUrl createdAt updatedAt author{username name} diffStatsSummary{additions deletions fileCount} headPipeline{status} resolvableDiscussionsCount resolvedDiscussionsCount reviewers{nodes{username mergeRequestInteraction{approved}}} approvedBy{nodes{username}}`; the three tab counts as aliased `count` fields in the same request | verified on 17.11.7 (introspection + live, 2026-10-12): every field exists, `not: {approvedBy}` filters (unlike REST `not[approved_by_usernames]`, S5), cursor paging works. Missing field on-prem → REST for that field only, noted here. REST lists (`reviewer_username`, `author_username`; `scope=reviews_for_me` is 400) stay for the tray poller |
| MR detail (incl. `diff_refs`: base/start/head SHA) | `GET /projects/:id/merge_requests/:iid` | standard |
| MR versions | `GET /projects/:id/merge_requests/:iid/versions` and `/versions/:version_id` (fields `head_commit_sha`, `base_commit_sha`, `start_commit_sha`, `created_at`) | standard |
| MRs of a commit | `GET /projects/:id/repository/commits/:sha/merge_requests` | standard |
| Discussions | `GET /projects/:id/merge_requests/:iid/discussions` | standard |
| Reply | `POST /projects/:id/merge_requests/:iid/discussions/:discussion_id/notes` (`body`) | standard |
| Resolve / unresolve | `PUT /projects/:id/merge_requests/:iid/discussions/:discussion_id?resolved=true|false` | standard |
| Draft notes | `POST /projects/:id/merge_requests/:iid/draft_notes` (`note`, `position[…]`, optional `in_reply_to_discussion_id`) | verified on 17.11.7 (S5) |
| Publish drafts at once | `POST /projects/:id/merge_requests/:iid/draft_notes/bulk_publish` | verified on 17.11.7 (S5, 204); its own `note` parameter is not published there, don't send it |
| Approve / revoke | `POST /projects/:id/merge_requests/:iid/approve` (send `sha` = reviewed head) · `POST …/unapprove` | standard |
| Approval state | `GET /projects/:id/merge_requests/:iid/approvals` | verified on unlicensed EE 17.11.7 (S5: `approved_by`, `approvals_required`, `approvals_left`, rules); the on-prem tier at field visit 1 |
| Create MR | `POST /projects/:id/merge_requests` (`source_branch`, `target_branch`, `title`, `description`, `reviewer_ids`, `remove_source_branch`, `squash`, `labels`; draft via the `Draft:` title prefix) | verified on 17.11.7 (S5): the `draft` field is ignored, the prefix works |
| Users for reviewers | `GET /projects/:id/members/all?query=<text>` | standard |
| MR pipelines | `GET /projects/:id/merge_requests/:iid/pipelines` | verified (python-gitlab docs) |
| New MR pipeline | `POST /projects/:id/merge_requests/:iid/pipelines` | verified (GitLab MR !16148; 200 on 17.11.7, S5) |
| Pipeline jobs | `GET /projects/:id/pipelines/:pipeline_id/jobs` (retried jobs excluded unless `include_retried=true`) | verified (Jobs API docs) |
| Job log | `GET /projects/:id/jobs/:job_id/trace` | verified |
| Play manual job | `POST /projects/:id/jobs/:job_id/play` with `job_variables_attributes: [{key, value}]` | verified |
| Manual job description / predefined variables (F-20.6) | none in the Jobs API (S5: the job object has no description or default variables) | the description is hidden and variables start empty (last values per job name come from `job_variables`) |
| Retry job | `POST /projects/:id/jobs/:job_id/retry` | verified |
| Cancel job | `POST /projects/:id/jobs/:job_id/cancel` | verified |
| Retry pipeline (failed/canceled jobs) | `POST /projects/:id/pipelines/:pipeline_id/retry` | verified (Pipelines API docs) |
| Cancel pipeline | `POST /projects/:id/pipelines/:pipeline_id/cancel` | verified |
| Test report | `GET /projects/:id/pipelines/:pipeline_id/test_report` | verified |
| Job artifacts | `GET /projects/:id/jobs/:job_id/artifacts` | standard |

Job statuses to handle: `created`, `pending`, `running`, `success`, `failed` (+ `allow_failure: true`), `canceled`, `skipped`, `manual`, also `waiting_for_resource`, `preparing`, `scheduled` (show as waiting). A new manual job reads `created` before it becomes `manual` (S5), so poll instead of expecting `manual` at once.

### Draft note positions
For a line comment on the reviewed version use the MR's `diff_refs` of that version:
`position[position_type]=text`, `position[base_sha]`, `position[start_sha]`, `position[head_sha]`, `position[old_path]`, `position[new_path]`, and
- added line: `position[new_line]`
- deleted line: `position[old_line]`
- context line: **both** `old_line` and `new_line`.
If the MR got a new version before publishing, re-map positions through the interdiff; drafts whose line no longer exists become general comments with the file:line quoted (ask the user first). The summary comment (F-12.4) is a draft note without a position, published in the same `bulk_publish` (confirmed in S5 on 17.11.7).

### Polling (tray)
Every N minutes: review-requested list, my MRs (with `updated_after`), MRs I reviewed (versions count changed → "N new commits"), discussions on my MRs (new notes since last seen), latest pipeline on my MRs. Store last-seen markers in `poll_state`. One request burst per interval, no more than ~10 requests.

---

## Claude Code (`claude -p`, user's own login)

The organization has no API key, so the app runs the Claude Code CLI in print mode under the user's Enterprise login. Facts checked in the CLI reference and headless docs (October 2026) and confirmed by the M0 spikes S1–S4 on Claude Code 2.1.296 (native) with a personal Max login (`08` › Spike notes, details in `spikes/m0-claude-pc-max.md`); field visit 1 repeats them on Claude Enterprise. Minimum version: **2.1.248** (`--restricted`).

- `--output-format json` returns metadata plus `result`; with `--json-schema '<schema>'` the validated object is in `structured_output`. `--output-format stream-json --verbose --include-partial-messages` streams events; the last line is the `result` message, also with a schema. Fields the runner uses: `is_error`, `result`, `structured_output`, `session_id`, `terminal_reason`, `api_error_status`, `permission_denials`, `total_cost_usd`. `subtype` stays `"success"` even when `is_error` is true, so it is never used to detect failure.
- `--json-schema` keywords are enforced: Claude Code rejects output that breaks `maxLength`, `pattern` or `minItems` and the model tries again (more turns). To comply, the model may shorten text or invent items, so schemas use `minItems` only where a value always exists (`claude/README.md`) and the Rust validation below stays authoritative.
- `--resume <session_id>` continues a conversation (needs session persistence); capture `session_id` from the JSON result. The system prompt recorded on the first turn is reused.
- `--model <alias|name>` and `--effort low|medium|high|xhigh|max` (levels depend on the model, see below).
- `--tools "Read,Grep,Glob"` restricts which built-in tools exist; `--allowedTools` only pre-approves. `--tools ""` leaves no tools.
- `--permission-mode dontAsk` denies anything that would prompt. A denied call doesn't fail the run: it is listed in `permission_denials` and the run can end with `is_error: false` (S1).
- `--restricted` (v2.1.248+, ADR-022) ignores the user, project and local settings files (only managed settings and `--settings` apply), so no hooks, plugins, output style, CLAUDE.md, AGENTS.md, rules, skills or auto memory from the user or the repository load (S2/S3). It removes command-running tools and WebFetch and confines the file tools to the working directory and `--add-dir`. `--strict-mcp-config` with no `--mcp-config` loads no MCP servers.
- **Without these flags, `-p` runs the hooks in a project's `.claude/settings.json` and connects `.mcp.json` servers, with no trust dialog, and loads all of the user's own configuration** (S3: under `--setting-sources user` every user hook ran, incl. hooks that inject text into the prompt). So the flags are mandatory for every task.
- `--bare` would avoid all of that **but does not use the subscription login** (needs `ANTHROPIC_API_KEY`), so it is not an option for us. The docs say bare mode will become the default for `-p` in a future release: pin and check every Claude Code update (see ADR-002 and the startup check below).
- `--append-system-prompt-file <file>` works (S1), although `claude --help` doesn't list it.
- `claude auth status` prints JSON with `loggedIn`, `authMethod` (`claude.ai` for subscription login, `none` when signed out), `apiProvider`, `analyticsDisabled`, `projectsDirectory`, `configDirectory`, `email`, `orgId`, `orgName`, `subscriptionType` (2.1.296) and exits with 1 when not signed in. It only reads the stored credentials: in S1 it reported `loggedIn: true` while the login had expired and could not be refreshed. The app reads only `loggedIn` and `authMethod` and never logs the rest.
- **Environment.** When the app's own environment contains `CLAUDECODE` (it was started from inside a Claude Code session, which happens only in development, e.g. `npm run tauri dev` in Claude Code), the runner removes `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_PID`, `CLAUDE_EFFORT` and `ANTHROPIC_BASE_URL` from the child's environment, so `claude` runs as if the app had been started from Explorer (the S1 harness did the same). Otherwise the environment passes through unchanged (proxy, `CLAUDE_CONFIG_DIR` and provider settings of the user or the organization keep working).

### Invocation profiles (built only in `claude/runner.rs`)

**Read-only** (plan, step analysis, questions, pipeline explanation, re-review summary, reply draft, MR description, commit message, rule suggestion, usages insight, summary comment, thread check):
```
claude -p
  --output-format json  (or stream-json --verbose --include-partial-messages for streaming tasks)
  --json-schema <schema json>                 (structured tasks)
  [--model <m>] [--effort <e>]                (omitted when "Same as Claude Code")
  --tools "Read,Grep,Glob"
  --permission-mode dontAsk
  --restricted                                (ADR-022)
  --strict-mcp-config
  --disallowedTools "mcp__*"
  --append-system-prompt-file <rendered system-common.md in tmp/<task-id>/>
  --add-dir <%APPDATA%\GuidedReview\tmp\<task-id>>   (without it, Read of the input files is denied)
  [--no-session-persistence]                  (one-shot tasks; omit where follow-ups are allowed)
  [--resume <claude_session_id>]              (follow-up questions)
cwd   = review worktree (others' MR) or repository root (own code, read-only tasks)
stdin = the task prompt (rendered template + inputs as files referenced by path in tmp/)
```
No positional argument follows the variadic options (`--tools`, `--add-dir`, `--allowedTools`, `--disallowedTools`); the prompt always goes through stdin.

After the run, a `permission_denials` entry for a Read under the task folder fails the task with `CLAUDE_FAILED` ("Claude couldn't read the task inputs."): otherwise the run ends with `is_error: false` and an answer built without its inputs (R-04).

**Fix on own code** (F-25), only when the session source is local or my own MR, run in a scratch worktree (ADR-018):
```
same as read-only, plus
  --tools "Read,Grep,Glob,Edit"
  --allowedTools "Edit(/<path of the one file, relative to the scratch worktree>)"
  --permission-mode dontAsk                                                         (any other edit is denied)
cwd   = scratch worktree created from `git stash create` (or HEAD)
```
The rule uses the anchored form (leading `/` = the session's working directory, i.e. the scratch worktree) with forward slashes, as tested in S4 (also with spaces and Polish characters). Rules are gitignore patterns: the runner escapes `*`, `?`, `[`, `]` and a leading `!` or `#` in the path with `\`. Never backslashes as separators (they match nothing) and never a bare file name (it matches at any depth).

After the process exits the app runs `git status --porcelain=v2` in the scratch worktree. If anything other than that file changed, it discards the run and fails with `CLAUDE_GUARD_VIOLATION`. Otherwise the proposal is the diff of that file. **Accept** writes the new content into the user's working copy only if the file's hash still equals the one taken when the run started; then the scratch worktree is removed.

### Tasks, models and contracts

| Task | Default model · effort | Override group (F-18.3) | Prompt | Schema | Streams |
| - | - | - | - | - | - |
| Review plan | opus · high | Review plan | `prompts/plan.md` | `schemas/plan.schema.json` | progress only |
| Step analysis | sonnet · medium | Step analysis | `prompts/step.md` | `schemas/step-findings.schema.json` | no |
| Questions | default · low | Questions | `prompts/ask.md` | none (text) | yes |
| Fix on own code | sonnet · medium | Fixes on your code | `prompts/fix.md` | `schemas/fix-result.schema.json` | no |
| MR description | sonnet · low | MR description and pipeline | `prompts/mr-description.md` | `schemas/mr-description.schema.json` | no |
| Pipeline explanation | sonnet · low | MR description and pipeline | `prompts/pipeline-explain.md` | `schemas/pipeline-explain.schema.json` | no |
| Commit message | haiku · low | Commit message | `prompts/commit-message.md` | `schemas/commit-message.schema.json` | no |
| Re-review summary | sonnet · medium | Step analysis | `prompts/rereview.md` | `schemas/rereview.schema.json` | no |
| Reply draft (author mode) | default · low | Questions | `prompts/reply-draft.md` | `schemas/reply-draft.schema.json` | no |
| Rule suggestion | haiku · low | Commit message | `prompts/rule-suggestion.md` | `schemas/rule-suggestion.schema.json` | no |
| Usages insight (F-23.4) | sonnet · medium | Step analysis | `prompts/usages-insight.md` | `schemas/usages-insight.schema.json` | no |
| Summary comment (F-12.4) | sonnet · low | MR description and pipeline | `prompts/summary-comment.md` | `schemas/summary-comment.schema.json` | no |
| Thread check (F-13.3) | sonnet · medium | Step analysis | `prompts/thread-check.md` | `schemas/thread-check.schema.json` | no |

A task uses its override group's model and effort; "Default" in a group means the global default (F-18.2). The plan prompt serves every source (MR, commit or range, local scope) through a `{{source_block}}` rendered by the core. The **File order** strategy is not in the plan schema; the core computes it as path order.

The prompts and schemas in `docs/claude/` are the starting point; copy them to `src-tauri/resources/` and bump `prompt_version` whenever you change one (it is part of the cache key). Validate every `structured_output` again in Rust before using it; this validation is authoritative even though the CLI enforces the schema:
- structural errors (wrong types, unknown hunk/step IDs, lines outside the step, files not in the change) → `CLAUDE_SCHEMA`, never partial data;
- evidence entries (`file:line` in findings, pipeline explanations and insights) must point at a file that exists in the worktree and a line within it, otherwise `CLAUDE_SCHEMA` (Claude cited something it didn't read);
- strings longer than the schema's `maxLength` → clamped with "…";
- a plan must reference at least 90% of the hunk IDs, otherwise `CLAUDE_SCHEMA` (a sign that Claude didn't read the inputs); the rest goes to the "Other" step (coverage invariant).

### Models and effort levels
The UI shows labels and stores full model IDs. Supported efforts per model come from the model-config documentation and the S1 probes (2026-10-11). Claude Code silently runs an unsupported level as the highest supported level below it; F-18.4 still disables unsupported levels in the UI, which matters for models added later.

| Label | `--model` | Efforts |
| - | - | - |
| Same as Claude Code | (flag omitted; under `--restricted` the default model of the account or of managed settings, ADR-022) | all |
| Opus 5.5 | `claude-opus-5-5` | low, medium, high, xhigh, max |
| Sonnet 5.5 | `claude-sonnet-5-5` | low, medium, high, xhigh, max |
| Haiku 5.5 | `claude-haiku-5-5` | low, medium, high, xhigh, max |
| Fable 5.1 | `claude-fable-5-1` | low, medium, high, xhigh, max (on a Max plan it needs usage credits: 429, see below) |

### Errors from Claude
Mapped in this order (S1):
1. Executable missing → `CLAUDE_NOT_FOUND`.
2. `is_error: true` with `api_error_status: 429` (stream-json also sends a `rate_limit_event` with `rate_limit_info.status: "rejected"`, an `errorCode` such as `credits_required` and `resetsAt`) → `CLAUDE_LIMITED` (F-18.7; the reset time comes from `resetsAt`, Claude Code's `result` text goes into `detail`).
3. `is_error: true` with `terminal_reason: "api_error"` and a `result` starting with "Not logged in" or "Failed to authenticate" → `CLAUDE_NOT_SIGNED_IN`. When the text is not recognised, a follow-up `claude auth status` with `loggedIn: false` maps the same way.
4. Any other `is_error: true` or non-zero exit (unknown model: `api_error_status: 404`; `--max-turns`: `terminal_reason: "max_turns"`; unknown flag or invalid schema: exit 1 with the message on stderr and no JSON) → `CLAUDE_FAILED` with Claude Code's message as `detail`.
A killed process writes no result; cancellation reports `CANCELLED`.

### Startup checks
1. Resolve the executable (ADR-021). `claude --version` → store; a version below 2.1.248 → `CLAUDE_FAILED` "Guided Review needs Claude Code 2.1.248 or later."
2. `claude auth status` → `loggedIn` must be true and `authMethod` must not be `none` (`CLAUDE_NOT_SIGNED_IN` otherwise). This only checks that credentials are stored.
3. Probe: `claude -p --output-format json --model haiku --tools "" --no-session-persistence --restricted --strict-mcp-config` with "Reply with OK" on stdin (without `--model` if the organization doesn't allow Haiku). It runs when the version changed since the last successful probe and after any task failed with `CLAUDE_NOT_SIGNED_IN`; Claude counts as healthy only if `is_error` is false. The status shown in F-18.1 and F-01.6 is the latest of: `auth status`, the probe, the last task result. The version of the last successful probe is kept in `app_state` (`claude.probedVersion`).
4. **Sign in to Claude Code** opens a new console window running `claude auth login` (the resolved executable, argument array, detached with its own console, never `cmd.exe`); when the app window gets focus again, steps 2 and 3 run again.

---

## Code index (S-12)

- Primary: **csharp-ls** (`dotnet tool install --global csharp-ls`), started in the review worktree (or repo root) with the solution: `csharp-ls --solution <path.sln>`, JSON-RPC over stdio. Requests: `initialize`, `textDocument/didOpen`, `textDocument/hover`, `textDocument/definition`, `textDocument/references`. Requires `dotnet restore` to succeed (MAUI workloads installed). **verify** current csharp-ls options.
- Alternative: Roslyn LSP (as used by the C# Dev Kit). Selectable in Settings › Integrations, same client.
- Fallback: tree-sitter index (`tree-sitter-c-sharp`) of declarations; usages by identifier match. The UI says "usages are matched by name".
- Membership: each location is tagged "In this MR · step N" if its file/line falls inside a hunk of the session, else "Outside this MR".
- Navigation works on the new side and context lines. Old-side symbols show the hover from tree-sitter only.

---

## JetBrains Rider

- Detect `rider64.exe`: Settings value → JetBrains Toolbox scripts folder (`%LOCALAPPDATA%\JetBrains\Toolbox\scripts\rider.cmd`) → `C:\Program Files\JetBrains\JetBrains Rider *\bin\rider64.exe` (highest version) → registry App Paths. **verify** in S9 (on the development PC with Rider installed the same way as on the team laptop, then the laptop's paths at field visit 1). A Toolbox `rider.cmd` must be resolved to the real `rider64.exe`, never run through `cmd.exe` (ADR-021 reasoning).
- Open at line: `rider64.exe --line <n> [--column <c>] <absolute file path>` (`--line` 1-based, `--column` 0-based, S9).
- External Tools: write a tool set "Guided Review" with "Review this branch" (`review --repo "$ProjectFileDir$" --branch current`) and "Review this commit" (`review --repo "$ProjectFileDir$" --commit "$ClipboardContent$"`) into Rider's config `tools\Guided Review.xml` (one file per tool set) for each installed Rider version, after backing up an existing file; ask the user to restart Rider. Verified in S9 (Rider 2026.2): Rider lists the set after a restart; `$SelectedText$` is only the editor selection, so the commit comes from the clipboard after Git log › Copy Revision Number. The clipboard can hold anything: `--commit` accepts only a hex SHA, and a rejected value is never shown or logged (T5). `$ProjectFileDir$` is the folder Rider opened, possibly below the repository root; the CLI resolves the repository with git.
- The app's own CLI (`GuidedReview.exe review --repo <path> --branch <name>|--commit <sha>`) is forwarded to the running instance by the single-instance plugin.

## Windows integration

- **Deep links** `guidedreview://mr/<iid>[?project=<path>]` (default repository without `project`), `guidedreview://commit/<sha>?repo=<path>`, `guidedreview://branch/<name>?repo=<path>`: Tauri deep-link plugin (scheme registered by the installer; `register()` in dev) + single-instance plugin with deep-link support so a running app receives the URL. Validate and whitelist every parameter.
- **Toasts with buttons**: if the notification plugin cannot show action buttons on Windows (**verify**), build toast XML through the Windows API (`windows` crate, `ToastNotificationManager`) with buttons whose `activationType="protocol"` and `arguments="guidedreview://…"`, so a click goes through the deep-link path. An unpackaged app needs an AppUserModelID and a Start-menu shortcut (created by the installer) for toasts; dev builds may show them under another app (**verify** in S7).
- **TLS** (S6): reqwest with `rustls-platform-verifier` (Windows chain verification incl. enterprise roots) or `native-tls` (SChannel); the spike picks the one that trusts the internal CA without extra configuration.
- **Tray**: Tauri tray icon (badge drawn into the icon image), left click toggles a frameless 410px window anchored above the icon, closing on blur.
- **Autostart**: autostart plugin (Settings › General › Start with Windows).
- **Credentials**: `keyring` service `GuidedReview`, account `<gitlab host>`.
- **Installer**: Tauri bundler (NSIS or MSI). Code signing if the company has a certificate.
