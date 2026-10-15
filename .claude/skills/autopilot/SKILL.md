---
name: autopilot
description: Build the open acceptance criteria of a Guided Review milestone unattended - the conductor loop of docs/process/AUTOPILOT.md (backlog → test author → implementer → fresh reviewer → deterministic gate → reflection → playbook, then live checks in the real app), kept going by the Stop hook, learning through the playbook and outcome metrics. Use when the user says /autopilot.
argument-hint: start <Mx> [--cap 12] [--budget tokens] | status | stop
disable-model-invocation: true
---

Arguments: $ARGUMENTS. The design and its rules: `docs/process/AUTOPILOT.md` (read §3.2 and §3.3 once). You are the **conductor**: you never write application code; subagents do, one role at a time. Keep your context small: read verdict JSON, not diffs or transcripts.

## status / stop
- `status`: `node tools/autopilot/run.mjs status`, `node tools/autopilot/backlog.mjs list`, `node tools/autopilot/judge.mjs --summary --run <runId>`.
- `stop`: `node tools/autopilot/run.mjs stop` (the conductor finishes its item, then closes).

## start <Mx>
1. Preconditions, else report and stop: the main checkout (`git rev-parse --git-dir` is `.git`, not a worktree), branch `m<N>-…`, `git status --porcelain --untracked-files=no` empty.
2. `node tools/autopilot/backlog.mjs sync --milestone <Mx>`. No `docs/plans/<Mx>.md` → planner role (`plan.md`, model opus) first, its decisions in one `backlog.mjs decision` call with item `<Mx> plan`, then sync again. Commit `docs/process/backlog.json` if it changed (`<Mx>: autopilot backlog sync`).
3. `node tools/autopilot/run.mjs start --milestone <Mx> [--cap N] [--budget B]` → prints the marker `AUTOPILOT <runId>`. Note `<runId>` and `<base>` (the branch).
4. Keep the PC awake if the tool exists (`mcp__ccd_host__request_keep_awake`); load `PushNotification` with ToolSearch for the notifications below.
5. Do one "Loop body", then end the turn with the line `AUTOPILOT <runId> next`. The Stop hook continues you with the next item; never ask the user anything.

## Loop body (one item per turn)
Paths: `<dir>` = `.autopilot/items/<id>/`; `<wt>`, `<branch>`, `<port>` from step b. Save every role's JSON answer as `<dir>/<role>.json` (fix and gate rounds `-1`, `-2`), adding `"tokens": <total tokens the Agent result reports>` (only a fallback: `record.mjs` takes the tokens per role from the subagent transcripts by the description `ap <role> <id>`).

a. `node tools/autopilot/backlog.mjs next` → `{none}`: do "Closing". Else the item `<id>` (note its `status` to resume). `backlog.mjs set <id> tests --attempt`. Note the start time.
b. `node tools/autopilot/worktree.mjs ready <id> --base <base>` → `{path, branch, port}`.
c. Context pack: files = the paths its plan row names plus what `git ls-files | grep` finds for them; `node tools/context-pack.mjs <id> <S-xx of the plan row if any> --plan <Mx> --files <a,b> --playbook <kind>,implement --out <dir>/context.md` (it lists the offered playbook ids).
d. **Roles** (Agent tool, `subagent_type` general-purpose, foreground, `description` `ap <role> <id>`). Prompt = the output of `node tools/autopilot/prompt.mjs <role> <id>`, passed unchanged (it joins `_common.md` and the role file and fills every `{{…}}` from the backlog, the run, the worktree and `<dir>`; fix problems come from the last failed `gate-N.json`, else from `review.json`). Exit 1 names the empty fields: supply them with `--extra '<json>'` (e.g. `{"problems": "…"}`), never by hand-editing the prompt. Plan: `prompt.mjs plan <Mx>`; curate: `prompt.mjs curate`.
   1. `tests.md` (model opus, E16) unless the item already has `lockSha`. Then `backlog.mjs set <id> impl --lock <git -C <wt> rev-parse --short HEAD> --tests <tests,…>` (test files only; it refuses production files the author touched, e.g. module wiring).
   2. `implement.md` (model opus for core/mixed, sonnet for ui). `backlog.mjs set <id> review`.
   3. `review.md` (model opus). Findings severe or normal, or an accepted test dispute → `fix.md` round 1 with those findings (same model as the implementer).
   Any role answering `needsOwner` → `backlog.mjs set <id> needs-owner --note "<why>"`, push notification "Autopilot: <id> needs you: <why>", go to g.
   Collect the `decisions` of every role answer of the item (tests, implement, fix rounds) in one list; step h files them once.
e. **Gate**: `node tools/autopilot/gate.mjs <id> --base <base> --branch <branch> [--lock <lockSha> --tests <…>] [--e2e <specs> --port <port>] [--complete when impl/fix said complete] --out <dir>/gate-1.json`. An accepted test dispute: the fix round commits the disputed test change alone; add `--dispute <file>@<that sha>`. Failed → `fix.md` round 2 with the failed checks → gate again as `gate-2.json`. Failed again, or a third round needed → `backlog.mjs set <id> blocked --note "<failed checks>"`.
f. Passed → `backlog.mjs set <id> done` (or `partial --note "<partialReason>"` when not complete; or `live --note "<what is built>"` when only a live check in `tauri dev` is left: the partialReason says so, or the item's note starts with "live check failed"; run the gate of such items without `--complete`) and `node tools/autopilot/worktree.mjs done <id>`.
g. **Reflect**: `prompt.mjs reflect <id>` (model sonnet; it takes the result from the item status and the offered ids from the pack). For each lesson `node tools/autopilot/playbook.mjs add '<json + "source": "<id>">'`; `playbook.mjs rate <id> helpful|harmful` for its ratings; `playbook.mjs tick`.
h. Decisions collected in d, if any, in one call: `node tools/autopilot/backlog.mjs decision '{"item":"<id>","decisions":[{question, chosen, alternatives, reversible}, …]}'` (one row per item, its questions as points (1), (2), …; a repeated question is skipped). Then `node tools/autopilot/record.mjs <id> --run <runId> --result <done|partial|blocked|needs-owner> --started <start>`; `backlog.mjs sync` (keeps statuses, picks up PROGRESS ticks and vetoes). Commit `docs/process/backlog.json docs/process/playbook.json docs/process/DECISIONS-PENDING.md .metrics/items.jsonl` as `<Mx>: autopilot <id> <result>`.
i. Every 5 recorded items of the run: `prompt.mjs curate` (model sonnet, works in the main checkout). Every 10: the `retro` skill with the argument "autopilot: judge the open experiments with tools/autopilot/judge.mjs (metric and since = the experiment's date); revert a 'revert' verdict with git revert of its commit".
j. End the turn with one short line of what happened and `AUTOPILOT <runId> next`.

## Closing (the Stop hook asks for it once)
1. **Live checks**, unless the run ends by `.autopilot/STOP` or the token budget: when `backlog.mjs list` shows items with status `live` (built; only the check in the real app is left), run the live role once for all of them in the main checkout: Agent, `subagent_type` general-purpose, model sonnet, foreground, `description` `ap live <Mx>`, prompt = `node tools/autopilot/prompt.mjs live` unchanged. Save its answer as `.autopilot/live/<runId>.json`. Per result: `pass` → `node tools/autopilot/live.mjs pass <id>` (ticks PROGRESS with the commits of its note); `fail` → `live.mjs fail <id> --note "<problem>"` (back to todo, the next run fixes it); `skip` → stays `live`, the reason goes into the summary. `node tools/audit.mjs --milestone <Mx>`, then commit `docs/PROGRESS.md docs/process/backlog.json` as `<Mx>: autopilot live checks <ids passed>`.
2. `node tools/autopilot/judge.mjs --summary --run <runId>`, `backlog.mjs list`, the rows of `DECISIONS-PENDING.md` logged in this run. Push notification "Autopilot <runId> done: <n> done, <m> blocked, <k> need you". Commit what is left, `node tools/autopilot/run.mjs end`, then the summary for the owner (items with result and merge SHAs, live checks with verdicts and `appCalls`, needs-owner and blocked with reasons, the decisions it made with their "why", metric means) ending with `AUTOPILOT <runId> stop: <reason>`.

## Rules
- Never write application code or tests yourself; never edit locked tests; never skip the gate; never push.
- Commands the permission mode blocks: record them in the item note and continue with the next item; never work around them.
- Never ask the user; everything they must see goes into DECISIONS-PENDING.md, needs-owner notes and notifications.
