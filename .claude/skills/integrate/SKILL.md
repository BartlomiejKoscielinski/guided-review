---
name: integrate
description: Merge the finished parallel lanes (E4) of a Guided Review milestone into the milestone branch - gate on tools/lanes.mjs list and the lane reports, /code-review each lane branch, merge --no-ff, verify with e2e, /audit, tick PROGRESS, remove the lanes. Use when the user says /integrate.
argument-hint: <milestone, e.g. M3> [lane ...]
disable-model-invocation: true
---

Arguments: $ARGUMENTS (milestone; lane names = only these lanes)

Runs in the main checkout on the milestone branch with `git status --porcelain --untracked-files=no` empty, never in a lane. `<Mx>` = `M3`, `<mx>` = `m3`; the lanes are the `## Lanes` rows of `docs/plans/<Mx>.md` (read only that section). Note `git rev-parse --short HEAD` as `<pre>`.

## 1. Gate (refuse: merge nothing)
`node tools/lanes.mjs list`. Refuse and report, for any selected lane:
- an `outside owns · <lane>: …` line (it changed files outside its `--owns`);
- an `overlap · <file>: …` line naming it (two lanes changed one file);
- `report` is `-` (no `.lanes/<lane>/report.md`);
- `dirty` > 0 (uncommitted work) or `commits` 0 (nothing to merge).

Lanes with `merged` = `yes` only need step 7. Then read each report (`.lanes/<lane>/report.md` in the lane worktree): keep its Done, Deviations, Contract requests and Open for steps 4, 6 and 8.

## 2. Review
For each lane: `/code-review <mx>/<lane>`; the diff that counts is `git diff <milestone branch>...<mx>/<lane>`. A finding that breaks a non-negotiable of `CLAUDE.md` or the contract (IPC types, files outside owns): do not merge that lane, report it. Other confirmed findings: fix them after the merge (step 4).

## 3. Merge
In `## Lanes` order: `git merge --no-ff <mx>/<lane> -m "<Mx>: merge lane <lane> (<AC IDs>)"` (no Co-Authored-By trailer). A conflict means the owns were not disjoint: `git merge --abort`, stop, report. Note each merge SHA.

## 4. Contract requests and review fixes
- Contract requests from the reports go through you: a plain IPC or shared-file change → make it now and resolve the lane's TODO; one that changes the spec or the plan → ask first (CLAUDE.md, How to work 7).
- `npm run gen:types` only when such a change touched a ts-rs type (lanes do not change types; after plain merges there is nothing to regenerate); commit the regenerated `src/ipc/types/` with it, every command still in both `src/ipc/tauri.ts` and `src/ipc/mock/`.
- Commits: `<Mx>: contract <what>`, `<Mx>: review fixes <lane>`.

## 5. Verify
- e2e on port 1420 if it is free (`netstat -ano | grep ':1420 .*LISTENING'` prints nothing). If something listens there (a `tauri dev` from `/app`, another session), never stop it: run with `GR_PORT=1500` (outside the lane range 1421-1499; check that it is free too).
- `node tools/verify.mjs --e2e` until green (the main checkout runs the Rust steps).

## 6. Audit and PROGRESS
- `/audit <Mx>` and fix what it reports.
- `docs/PROGRESS.md` by section (`grep -n '^## \|^- \[ \]'`): tick the ACs each report lists as done with their lane commit SHAs (now in history); partial ones `— partial: <what is missing>`. `node tools/audit.mjs --milestone <Mx>` shows no SHA gap. The session-log row and the commit come from `/handoff` (step 8).

## 7. Remove the lanes
Per merged lane: `node tools/lanes.mjs remove <lane> --delete-branch` (copies `report.md` into `.lanes/<lane>/` here, removes the worktree, `git branch -d`). It refuses a dirty lane or an unmerged branch: report, never add `--force` without the user's OK. `node tools/lanes.mjs list` and `git worktree list` no longer show them.

## 8. Report and hand off
Per lane: merged (merge SHA) or refused (why); review findings fixed; deviations and open items from the reports; contract changes; verify and e2e result (port). Then `/handoff` (session-log row: lanes, merge SHAs, deviations).
