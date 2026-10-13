---
name: fanout
description: Start parallel lanes (E4) of a Guided Review milestone from its committed contract - for each row of `## Lanes` in docs/plans/<Mx>.md a context pack, a worktree (tools/lanes.mjs) and a lane prompt. With --dry-run it only checks the contract and writes the prompts. Use when the user says /fanout.
argument-hint: <milestone, e.g. M3> [--dry-run] [lane ...]
disable-model-invocation: true
---

Arguments: $ARGUMENTS (milestone; `--dry-run`; lane names = only these rows)

Runs in the main checkout on the milestone branch (`mN-…`; lanes branch off it as `mN/<lane>`), never in a lane worktree. `<Mx>` = `M3`, `<mx>` = `m3`.

## 1. Read the contract (only this)
`grep -n '^## ' docs/plans/<Mx>.md`, then Read only the `## Lanes` section (offset/limit):

| Lane | Goal | Owns | AC | Model / effort | Migrations |
| - | - | - | - | - | - |
| `focus` | one line | `src/screens/step/**,tests/e2e/step*` | `F-07 S-03 F-06.9` | Sonnet 5.5 / medium | `-` or `005` |

- Lane: `^[a-z0-9][a-z0-9-]{0,30}$` (`LANE_NAME` in `tools/lanes-lib.mjs`).
- Owns: comma-separated globs, passed verbatim to `lanes.mjs create --owns`.
- AC: `F-xx`, `F-xx.n`, `S-xx` separated by spaces, passed verbatim to `tools/context-pack.mjs`.
- Migrations: numbers reserved for this lane; the files do not exist yet.
- The rest of the contract: IPC types (`src/ipc/types/`, ts-rs types in `src-tauri/src`) and the IPC commands of all lanes (`src/ipc/tauri.ts` + mock stubs in `src/ipc/mock/`), committed with the plan.

## 2. Check the contract
Collect every problem. Without `--dry-run` any problem stops the run before step 3 (report them, change nothing). With `--dry-run` report them and continue to step 4.
1. Branch `git branch --show-current` starts with `<mx>`; `git status --porcelain --untracked-files=no` is empty (`lanes.mjs create` refuses otherwise) and `git status --porcelain -- docs/plans src/ipc src-tauri/src` is empty (untracked counts: the plan and types must be committed).
2. Rows: all six cells filled, lane names valid and unique; for each lane no registry entry (`node tools/lanes.mjs list`), no branch (`git branch --list <mx>/<lane>`), no `../gr-<lane>`.
3. Owns: disjoint (no path matched by globs of two lanes; when unsure, `git ls-files -- ':(glob)<glob>'`). No lane owns contract or shared files: `docs/**`, `src/ipc/types/**`, `src/ipc/tauri.ts`, `package*.json`, `src-tauri/Cargo.*`, `.claude/**`, `tools/**`.
4. AC: every `F-xx.n` has a row in the `## AC → build → test` table of the plan and every `F-xx` at least one (`grep -c '^| <ID>[ .]' docs/plans/<Mx>.md`); every `S-xx` has a section in `docs/02-screens.md` (`grep -n '^## <ID> '`); each ID in one lane only.
5. Migrations: unique across lanes, above the highest file in `src-tauri/src/store/migrations/`, no file with that number. `migrations.rs` lists the files, so at most one lane reserves migrations and it owns `src-tauri/src/store/migrations.rs` and `src-tauri/src/store/migrations/<NNN>_*`; more lanes needing schema changes → the migrations go into the contract.
6. Context pack per lane: `node tools/context-pack.mjs <AC> --plan <Mx> --lane <lane>` → `.lanes/<lane>/context.md` (ignored by git). Over budget it writes nothing and prints the sizes: a problem, propose a split.

## 3. Worktrees (skip with `--dry-run`)
`git worktree list` (keep it). Per lane, one at a time: `node tools/lanes.mjs create <lane> --owns "<owns>" --branch <mx>/<lane>` (npm ci; copies the context pack into the lane). Read `port` and `rust` from `.lanes/<lane>/lane.json` in the lane worktree. If one fails: stop, report which lanes exist (`node tools/lanes.mjs remove <lane> --delete-branch` undoes one).

## 4. Lane prompts
Write `.lanes/<lane>/prompt.md` in the main checkout from this template, in the user's language (as `/handoff`), keeping paths, commands and IDs; drop lines in `[...]` that do not apply. With `--dry-run`: `<port>` = "assigned by lanes.mjs create", `<base>` = `git rev-parse --short HEAD`.

```
<Model> · effort <effort> · Guided Review · lane <lane> (<Mx>, E4). Worktree ..\gr-<lane>, branch <mx>/<lane> from <base>; mock dev server on port <port> (GR_PORT is set in .claude/settings.local.json).
[Rust: own src-tauri/target, the first build is slow.] [No Rust: /verify skips the Rust steps.]
Goal: <goal>. AC: <AC>.

Read only .lanes/<lane>/context.md (ACs, plan rows, screens, mocks, files); it replaces the reading list in CLAUDE.md. Do not read docs/0*.md, docs/PROGRESS.md or files outside your lane; open design PNGs only as crops.
You may change only: <owns>. [Migrations: only <NNN>, registered in src-tauri/src/store/migrations.rs.]
IPC types and commands are the contract (src/ipc/types/, ts-rs types, src/ipc/tauri.ts): do not change them. A change you need outside your files: don't make it; put it under "Contract requests" in the report and leave a TODO with the AC ID.

Rules (this worktree has no project memory):
- Commits "<Mx>: <AC IDs> <summary>" without a Co-Authored-By trailer; no push, merge, rebase or branch switch.
- Fake tokens in tests: never "glpat-" (or any "gl…-") followed by 20+ [0-9A-Za-z_-]; break the run with a "." or build the string at runtime (public repo, push protection).
- Deleting in Node: fs.promises.rm or unlinkSync, never fs.rmSync (Node 24.13 silently keeps paths with Polish letters).
- No /app, no npm run tauri dev, no /audit or /retro; never write docs/PROGRESS.md or .metrics/. UI only against the mock backend.
- Tests carry the AC ID in their name.

Tasks:
1. Build the ACs in the order of the plan rows in context.md; commit after each coherent piece.
2. /verify green, with e2e for your specs (node tools/verify.mjs --e2e <spec>); /design-check S-xx for each screen you touched.
3. /handoff: in a lane it writes .lanes/<lane>/report.md instead of PROGRESS. At the 120k context warning: commit, /handoff with what is open.
Then stop; the integrator runs /integrate <Mx> in the main checkout.
```

## 5. Report
- Table: lane · branch · worktree · port · rust · context tokens · model / effort · problems.
- `--dry-run`: `git worktree list` again; it must be unchanged. Say that nothing was created.
- Otherwise: for each lane, open a new Code session in `C:\Repos\gr-<lane>` with its model and effort and paste `.lanes/<lane>/prompt.md`. When every lane has its report: `/integrate <Mx>` here.
