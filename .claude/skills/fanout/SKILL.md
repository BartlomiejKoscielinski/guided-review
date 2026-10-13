---
name: fanout
description: Start parallel lanes (E4) of a Guided Review milestone from its committed contract - for each row of `## Lanes` in docs/plans/<Mx>.md a context pack, a worktree (tools/lanes.mjs) and a lane prompt, then it runs the lanes as background subagents and integrates them through an integrator subagent, without the owner. With --dry-run it only checks the contract and writes the prompts. Use when the user says /fanout.
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
6. Context pack per lane: `node tools/context-pack.mjs <AC> --plan <Mx> --lane <lane> --files <a,b>` → `.lanes/<lane>/context.md` (ignored by git). `--files`: the existing files the lane changes or must read (its owns narrowed with `git ls-files`, plus read-only files its plan rows name); without it a Rust pack lists no files (P-5). Over budget it writes nothing and prints the sizes: a problem, propose a split.

## 3. Worktrees (skip with `--dry-run`)
`git worktree list` (keep it). Per lane, one at a time: `node tools/lanes.mjs create <lane> --owns "<owns>" --branch <mx>/<lane>` (npm ci; copies the context pack into the lane). Read `port` and `rust` from `.lanes/<lane>/lane.json` in the lane worktree. If one fails: stop, report which lanes exist (`node tools/lanes.mjs remove <lane> --delete-branch` undoes one).

## 4. Lane prompts
Write `.lanes/<lane>/prompt.md` in the main checkout from this template, in the user's language (as `/handoff`), keeping paths, commands and IDs; drop lines in `[...]` that do not apply. `<lane path>` = `path` from lane.json with forward slashes (`C:/Repos/gr-<lane>`). Start here: the functions and types the lane extends and the read-only files it needs (grep the code, file + symbol + what to do); required when the context pack lists few files, since nobody answers a lane's questions. With `--dry-run`: `<port>` = "assigned by lanes.mjs create", `<base>` = `git rev-parse --short HEAD`.

```
<Model> · effort <effort> · Guided Review · lane <lane> (<Mx>, E4). Worktree <lane path>, branch <mx>/<lane> from <base>; [UI: mock dev server on port <port>] [No UI: port <port> unused].
[Rust: own src-tauri/target, the first build is slow.] [No Rust: /verify skips the Rust steps.]
Goal: <goal>. AC: <AC>.

Read only .lanes/<lane>/context.md (ACs, plan rows, screens, mocks, files) and the files under "Start here"; it replaces the reading list in CLAUDE.md. Do not read docs/0*.md, docs/PROGRESS.md or other files outside your lane; open design PNGs only as crops.
You may change only: <owns>. [Migrations: only <NNN>, registered in src-tauri/src/store/migrations.rs.]
IPC types and commands are the contract (src/ipc/types/, ts-rs types, src/ipc/tauri.ts): do not change them. A change you need outside your files: don't make it; put it under "Contract requests" in the report and leave a TODO with the AC ID.

Start here (code anchors; files outside "You may change only" are read-only):
- <file>: <symbol> — <what to add or change>
Scope: <what belongs to this lane and what does not>.

Rules (this worktree has no project memory):
- Commits "<Mx>: <AC IDs> <summary>" without a Co-Authored-By trailer; no push, merge, rebase or branch switch.
- Fake tokens in tests: never "glpat-" (or any "gl…-") followed by 20+ [0-9A-Za-z_-]; break the run with a "." or build the string at runtime (public repo, push protection).
- Deleting in Node: fs.promises.rm or unlinkSync, never fs.rmSync (Node 24.13 silently keeps paths with Polish letters).
- No /app, no npm run tauri dev, no /audit or /retro; never write docs/PROGRESS.md or .metrics/. [UI only against the mock backend.]
- Tests carry the AC ID in their name.

You are a background subagent of the integrator session (Agent tool); nobody else sees you:
- Your working directory is the lane worktree <lane path>, not the main checkout: start every Bash command with cd "<lane path>" &&; Read, Edit and Write only absolute paths under <lane path>. The lane's .claude/settings.local.json does not reach you: put GR_PORT=<port> in front of every command that starts the mock dev server or e2e.
- Skills: not through the Skill tool (it works in the main checkout). Read <lane path>/.claude/skills/<name>/SKILL.md and follow it in the lane (/verify, /design-check, /handoff in lane mode).
- Nobody answers questions or approves a plan. Where CLAUDE.md says stop and ask (unclear spec, changing a decision), don't ask: write the question under "Open" in the report, skip that piece and do the rest.
- An action the permission mode blocks goes into the report; don't work around it with another command.
- Never touch the main checkout or other ../gr-* worktrees.
- Long steps (cargo, Playwright, design-check) only through node tools/verify.mjs and tools/mock-preview, in the foreground; leave no background process (stop your dev server) at the end.
- The last step is always a commit and /handoff (the report), also when something stays open. Final answer, at most 8 lines: commits (short SHA + subject), report path, open items, contract requests.

Tasks:
1. Build the ACs in the order of the plan rows in context.md; commit after each coherent piece.
2. /verify green, with e2e for your specs (node tools/verify.mjs --e2e <spec>); /design-check S-xx for each screen you touched.
3. /handoff: in a lane it writes .lanes/<lane>/report.md instead of PROGRESS. At the 120k context warning: commit, /handoff with what is open.
Then stop; the integrator runs /integrate <Mx> in the main checkout.
```

## 5. Run the lanes (skip with `--dry-run`)
Nothing here needs the owner; this session only orchestrates (its context stays small).
1. All lanes in one message, one Agent call each: `subagent_type` general-purpose, `model` from the lane's model (Opus → opus, Sonnet → sonnet, Haiku → haiku, Fable → fable), `effort` from its `## Lanes` row, `run_in_background` true, `description` `lane <lane>`, `prompt` = the text of `.lanes/<lane>/prompt.md`. Note the UTC start time. Don't poll; each lane's completion notification wakes you.
2. When every lane has finished: `node tools/lanes.mjs list`. Then one foreground subagent integrates (`model` opus, `effort` medium, `description` `integrate <Mx>`), prompt: "Integrator for <Mx> (E4) in the main checkout <main path>, branch <milestone branch>. Read .claude/skills/integrate/SKILL.md and do steps 1–7 for the lanes <lanes> (the skill is not model-invocable; you run its steps). Step 2: the code-review skill if you can invoke it, else review `git diff <milestone branch>...<mx>/<lane>` yourself for correctness and the CLAUDE.md non-negotiables. Step 5: port 1420 busy → GR_PORT=1500. Nobody answers questions: a refusal or a spec question goes into your answer. Answer with the step 8 report (no /handoff)."
3. Its report goes into this session's `/handoff` (session-log row: lanes, start → merge time, merge SHAs, deviations, contract requests).

## 6. Report
- Table: lane · branch · worktree · port · rust · context tokens · model / effort · problems.
- `--dry-run`: `git worktree list` again; it must be unchanged. Say that nothing was created.
