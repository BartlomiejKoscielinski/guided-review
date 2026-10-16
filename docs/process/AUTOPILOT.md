# Autopilot · implementation plan (E10)

Status: **approved** by the owner with the decisions of §6 (2026-10-14); built in session P-7, piloted in A-3; §9 says what is built, what the first run verified and what has never run yet. Replaces E4 (parallel writer lanes) as the default way of building milestones. Cost of 3–4 agents per acceptance criterion: accepted by the owner.

## 1. Goal

A mechanism that builds the remaining acceptance criteria of a milestone **without the owner confirming anything**, and that **gets better over time** from its own results.

Success = the pilot (session A-3) meets all of:

| Metric | Baseline | Target |
| - | - | - |
| ACs done in one unattended run (owner input: none) | 0 (every session starts from a pasted prompt) | ≥ 5 |
| Non-negotiable violations merged | — | 0 |
| Milestone branch green after every merge (`verify`) | — | 100% |
| Gate passed on the first attempt | unmeasured | measured; ≥ 60% |
| Severe review findings caught before merge | unmeasured | measured |
| Tokens (cache read) per AC | P-x sessions: 6–12M for 1–3 ACs | measured, compared |
| Playbook entries reused with a positive count | — | ≥ 1 |

## 2. Principles (from the research, 2026-10-14)

1. **Writes stay single-threaded** (Cognition 2026; Anthropic: coding has few truly parallel tasks). One AC at a time writes code; parallelism only for reading agents (test authoring from the spec, review, exploration). Our pilot: integrator 17.4M cache read vs 1.5M per lane.
2. **Fresh-context reviewer**: coder and reviewer share no context (Devin Review: ~2 bugs/PR, 58% severe).
3. **Long-running harness** (Anthropic): a machine-readable feature list with a pass flag, one feature per pass, commit after each, startup smoke check, tests may not be edited to pass (test ratchet), end-state evaluation.
4. **Delegation contract**: every subagent gets objective, output format, tools, boundaries; it writes results to files and returns a short verdict.
5. **Loop without a human**: a Stop hook keeps the conductor going while ready work and budget remain (Ralph loop), with an iteration cap and a kill switch.
6. **Learning by small deltas** (ACE): itemized playbook entries with counters, added by a Reflector, merged/pruned by a Curator; never rewritten wholesale. A lesson becomes a rule only after it recurs (3×).
7. **Process changes are experiments judged on outcome metrics**, reverted automatically when they make things worse.

## 3. Architecture

```
owner ──(optional, async: reads results, may veto a logged decision, answers needs-owner)──┐
                                                                                    v
Conductor session (main checkout, milestone branch, Opus)            docs/process/DECISIONS-PENDING.md
  loop: backlog next → pipeline(item) → gate → reflect → record → (curate/retro every N)
  Stop hook: continue while ready items ∧ budget ∧ iterations < cap ∧ no .autopilot/STOP
        │ foreground Agent calls, one role at a time (reading roles may run in parallel;
        │ the test author of the next item runs in the background, §3.4)
        v
  Worktree ../gr-ap (port 1510), branch ap/<item> from the milestone branch
    1 Test author (Sonnet)  → failing tests 'F-xx.n …' from spec/screen/mock only → commit, tests locked
                              (skipped when the item comes with tests written ahead: §3.4)
    2 Implementer (Opus core / Sonnet UI) → code until tests pass, /verify → commit
       ┆ background: test author of the next ready item in ../gr-ap-2 (port 1511),
       ┆ branch ap/<next> from the tip of ap/<item> → status tests-ready (§3.4)
    3 Reviewer (Opus, fresh)  → findings JSON (+ /design-check structure for UI)
       ↺ implementer fix round (max 2)
    4 Gate (script, no LLM)    → verify (+e2e for UI), audit, locked tests unchanged, owns, rule greps
                               → ff-merge into the milestone branch, tick PROGRESS
    5 Reflector (Sonnet)       → 0–3 playbook deltas
```

### 3.1 State (files)

| File | Committed | Content |
| - | - | - |
| `docs/process/backlog.json` | yes | Items synced from `PROGRESS.md` + `plans/<Mx>.md`: `{id, milestone, title, kind: core\|ui\|docs\|mixed, deps[], status: todo\|tests\|tests-ready\|impl\|review\|done\|partial\|live\|blocked\|needs-owner, attempts, lockSha?, tests?, forkSha? (only while tests-ready, §3.4), disputes?, note}`. JSON, not Markdown (agents mangle it less). Only the conductor and `backlog.mjs` write it. |
| `docs/process/playbook.json` | yes | `[{id, tags[], text, helpful, harmful, created, lastUsed, source}]`; tags = path globs, item kinds, roles. |
| `docs/process/DECISIONS-PENDING.md` | yes | Decision log: `ID · date · item · question · chosen — why · alternatives · reversible · status (decided/accepted/vetoed)`. |
| `.metrics/items.jsonl` | yes | One row per item attempt: tokens per role, wall time, gate first pass, rounds, findings by severity, result, escaped defects (filled later). |
| `.autopilot/run.json` | no | `{runId, startedAt, iterations, cap, budgetTokens, milestone}`; `.autopilot/STOP` = kill switch. |
| `.autopilot/items/<id>/` | no | Role verdicts (`tests.json`, `impl.json`, `review.json`, `gate.json`), the context pack; `tests-discarded.json` = tests ahead that were thrown away (§3.4). |

### 3.2 Decision policy (replaces "stop and ask" for the autopilot)

- **Spec unclear or contradicting a mock**: the autopilot decides and continues; the decision is final and nothing waits for the owner (owner, 2026-10-14, replacing the review of provisional rows and the cap of 5). Best option for the user, in order: what the spec and mocks imply; consistency with the existing screens and `03-design-system.md`; established UI/UX principles (Nielsen's heuristics, WCAG 2.2 AA, Windows conventions, least surprise, reversibility, fewest clicks on the frequent path); a one-sentence "why" per decision. The fresh reviewer judges UI/UX choices the spec leaves open (a clearly worse one is a normal finding). Only questions that neither the spec nor the mock answers and that change what the user sees or how the app behaves; implementation choices go to the role's notes. The conductor collects the decisions of all roles of one item and files them once: one row per item in `DECISIONS-PENDING.md`, the questions as points (1), (2), …; a later round of the same item appends to its `decided` row.
- **Needs-owner** (item skipped, push notification): anything touching the non-negotiables of `CLAUDE.md` (Claude flags, security, secrets, company data, GitLab write actions without a click), real company data or a field visit (ADR-019), changing an ADR, new dependencies, deleting tests.
- **Veto** by the owner (status `vetoed` in the file): the next sync adds a rework item.

### 3.3 Safety rails

- Iteration cap per run (default 12 items), daily token budget from the metrics ledger, kill switch `.autopilot/STOP`.
- Max 2 fix rounds and 2 attempts per item → `blocked` with a report, next item.
- No destructive git outside `../gr-ap`, `../gr-ap-2` and the `ap/*` branches; nothing is pushed; the owner opens PRs.
- Self-modification allowlist: retro/curator may change `docs/process/playbook.json`, `.claude/skills/**` (except non-negotiable text), `tools/autopilot/**`; the curator adds learned rules to `.claude/autopilot/roles/*.md` only through `playbook.mjs promote` (covered by the `node tools/autopilot/*` allow rule, so no approval is needed). Never `CLAUDE.md` non-negotiables, `docs/0*.md` decisions, security rules.
- Explicit `allow` rules for the few operations the classifier blocks (auto mode falls back to manual prompts after 3 blocks in a row or 20 per session).

### 3.4 Tests ahead (E22)

Why: in run ap-20261015-1609 an item took 44 min, 12 of them the test author's. The test author of the next item needs neither the review nor the gate of the current one, so it works while they run. Application code stays single-threaded (principle 1): only tests are written in parallel, on their own branch, and no agent merges anything; the merge is a git step of `worktree.mjs` with a fixed rule (E4's integrator is what this avoids).

- **Two fixed worktrees.** `../gr-ap` (port 1510) implements, reviews and gates one item at a time, as before. `../gr-ap-2` (port 1511) holds only the test author of the next item. It keeps only committed work: before every use `worktree.mjs` drops what a stopped author left uncommitted.
- **When.** Right after the implementer of item X commits, `backlog.mjs ahead X` names the item Y that `next` returns once X is done, if Y still needs a test author (`todo`, no lock) and the run does not end after X (cap, budget, `.autopilot/STOP`; the Stop hook's own rule, `runEnding`). Else nothing runs ahead.
- **Where.** `worktree.mjs ahead Y --from X` puts `../gr-ap-2` on a fresh `ap/<Y>` from the tip of `ap/<X>`, so the author sees X's code (`fork` = that tip). The prompt (`prompt.mjs tests Y --ahead X`) says so: X may still change in a fix round; leave X's files alone where possible. Every criterion writes its browser tests in a spec of its own (`tests/e2e/<screen>-<slug>.spec.ts`, role `tests.md`), never in a spec or helper another criterion wrote, so the two branches rarely touch the same file.
- **Background, no polling.** The conductor starts that author with the Agent tool and `run_in_background`, then goes on with X's review, fix rounds, gate and reflection. When its notification arrives: tests committed → `backlog.mjs set Y tests-ready --lock <sha> --tests … --fork <fork>`; failed or needs-owner → `worktree.mjs discard Y` (and needs-owner as usual).
- **Waiting.** If the loop reaches Y while its author still works, the conductor ends the turn with one line without the marker (`Waiting for the tests of Y.`). The Stop hook continues only a turn with the marker (`decide`: "not the conductor"), so it lets this turn end and counts no iteration; the agent's end notification wakes the conductor, which records the tests and goes on with Y.
- **Taking them over.** `worktree.mjs ready Y` (status `tests-ready`) frees the branch in `../gr-ap-2`, checks the fork is on the milestone branch (X passed its gate and was merged) and merges the milestone branch into `ap/<Y>` (X's fix rounds and PROGRESS tick). It prints `tests: "kept"` and `lock` = the merge commit: the gate compares the locked tests with it, so what the merge brought from the milestone branch is not a change of them, and its `commits` list skips the merge (`git log --no-merges`). Y's implementer starts from there.
- **Thrown away.** X not merged (blocked, needs-owner) or a merge conflict → `tests: "discarded"` with the reason; `ap/<Y>` starts again from the milestone branch, `backlog.mjs set Y tests --attempt --discard` drops the lock, and Y's tests are written again in `../gr-ap` as before. Cost: what it costs today, plus the discarded author. A branch a stopped author left in `../gr-ap-2` is discarded the same way.
- **Measure and verdict.** Run time per finished criterion (`pace`), because the times of single items now overlap. The conductor judges E22 itself at Closing (`judge.mjs --run <id> --against ap-20261015-1609 --pace-below 40`, no LLM) and the retro skill applies `keep` or `revert`; `wait` while fewer than 3 items finished or one came with tests from an earlier run. The tokens of a test author working ahead count for its item (`record.mjs` takes the tests role from the run's start). See E22 in `IMPROVEMENTS.md`.

## 4. Build list

| # | Component | Files | Tests |
| - | - | - | - |
| B1 | Backlog: `sync` (PROGRESS unchecked + plan AC table → items, keep statuses), `next` (first `todo` with deps done; decisions never block it), `set <id> <status> [--note]`, `decision` (one row per item) | `tools/autopilot/backlog.mjs`, `tools/autopilot/backlog-lib.mjs` | `tools/autopilot-backlog.test.mjs` (fixture PROGRESS/plan) |
| B2 | Gate: verify (`--e2e <spec>` for UI), `audit --milestone`, locked tests unchanged since `lockSha` (`git diff --name-only lockSha..HEAD -- <test files>`), changed files within the item's kind, rule greps (`--bare`, `--dangerously-skip-permissions`, `unwrap()` outside tests, `glpat-` + 20 chars, hex colors in components), ff-merge, PROGRESS tick with SHA; JSON verdict | `tools/autopilot/gate.mjs` | `tools/autopilot-gate.test.mjs` (throwaway repo) |
| B3 | Run state `tools/autopilot/run.mjs` (start, status, stop, end) and worktree `tools/autopilot/worktree.mjs` (ready, done, remove). Stop hook: binds to the conductor by the marker `AUTOPILOT <runId>` in the last assistant message (transcript tail, as in `context-guard.mjs`); blocks the stop with "next item" while the conditions hold; otherwise allows it. Context guard: in a marked session it says "write state, continue" instead of "/handoff" | `tools/autopilot/stop-hook.mjs`, `tools/metrics/context-guard.mjs`, `.claude/settings.json` | `tools/autopilot-hook.test.mjs` (fake transcripts) |
| B4 | Conductor skill `/autopilot start\|status\|stop [Mx] [--cap N]`: run file, keep-awake, loop body, role calls with fixed prompts, verdict handling, notifications, curate every 5 items, retro every 10 | `.claude/skills/autopilot/SKILL.md` | dry run (B7) |
| B5 | Role prompts (objective, inputs, output JSON, boundaries, done condition): tests, implement, review, fix, reflect, curate, plan (milestone planning when the backlog of the milestone is empty); composed and filled by `prompt.mjs` | `.claude/autopilot/roles/*.md`, `tools/autopilot/prompt.mjs`, `tools/autopilot/prompt-lib.mjs` | `tools/autopilot-prompt.test.mjs` (every role composes, an empty field fails) |
| B6 | Playbook: `add`, `select --tags` (into the context pack, ≤ 1.5k tokens), `score <id> helpful\|harmful`, `curate` (dedupe, promote 3× recurring to a skill rule proposal, prune unused 30 items) | `tools/autopilot/playbook.mjs`, `tools/context-pack.mjs --playbook` | `tools/autopilot-playbook.test.mjs` |
| B7 | Outcome metrics + judge: `items.jsonl` rows from verdicts; `judge.mjs` compares an experiment's metric over the next K = 5 items with the 5 before → keep / revert (`git revert <experiment sha>`) | `tools/autopilot/record.mjs`, `tools/autopilot/judge.mjs` (`--summary` per run) | `tools/autopilot-judge.test.mjs` |
| B8 | Settings: Stop hook registration; `allow` rules: `git worktree remove ../gr-ap`, `git branch -d ap/*`, `git branch -d m*/*` merged lanes; `test:tools` glob covers the new tests | `.claude/settings.json`, `package.json` | `npm run test:tools` |
| B9 | Docs: CLAUDE.md "How to work" (autopilot mode + decision policy), IMPROVEMENTS (E4 closed as replaced, E10 open), `/fanout` and `/integrate` marked legacy | `CLAUDE.md`, `docs/process/IMPROVEMENTS.md`, skills | `/audit` unaffected |

No new npm or cargo dependencies (Node built-ins only).

## 5. Pipeline details

- **Startup routine of every role**: `cd ../gr-ap`, `git log --oneline -5`, read its inputs only, `node tools/verify.mjs --only typecheck` as a smoke check (implementer only).
- **Test author** reads: the AC text, the `S-xx` section and mock crop (UI), the plan row; never the implementation. Writes Vitest/Rust/Playwright tests named with the AC ID that fail for the right reason; commits; the conductor stores `lockSha` and the test file list. A test it cannot write meaningfully (live check, field visit) → the item keeps a `manual` note, the gate skips the lock check.
- **Implementer** reads the context pack (`context-pack.mjs <AC> --plan <Mx> --files … --playbook`), may not change locked test files (gate enforces; a wrong test → `testDispute` in its verdict, decided by the reviewer).
- **Reviewer** gets `git diff <milestone>...ap/<item>`, the AC text and `CLAUDE.md` non-negotiables; returns `{findings: [{severity: severe|normal|nit, file, line, text}], testDispute?: accept|reject}`; UI items also run `/design-check` structure mode. Severe or normal findings → one fix round.
- **Gate** is deterministic; its JSON verdict is the only thing that decides merge.
- **Live checker** (Sonnet, main checkout, once per run at the start of "Closing"): the items with status `live` (built; only the check in `tauri dev` left: a PROGRESS note ending in `open: live check …`, or the conductor after a gate). It drives the real app with `tools/app-driver/app.mjs` (batches via `run`, ≤ 8 calls per criterion, Docker and the stand-in started if needed, real Claude only when the criterion needs it, on cached plans and notes where it can; the app's per-task models (F-18.3) are never changed in Settings; `npm run eval:claude` when the note says the open part is the Claude eval), takes expected values from the seed and fixtures, and answers pass / fail / skip per criterion. `tools/autopilot/live.mjs pass` ticks PROGRESS with the commits of the note; `fail` sends the item back to todo ("live check failed: …"), and after its fix the gate runs without `--complete` and the item waits as `live` again.
- **Reflector** gets the item's verdicts (not the transcripts) and answers: what went well, what was slow or wrong, what to do differently; writes 0–3 deltas with tags. A delta that duplicates an entry increments its count instead.

## 6. Owner decisions (recommended answers; approving this plan approves them)

1. **CLAUDE.md "How to work" 1, 7, 10**: in autopilot mode plans are not waited for and unclear specs follow §3.2. Interactive sessions keep the current rules.
2. **Memory "Go with recommended"**: "keep explicit approval gates" becomes "approval gates only for needs-owner items (§3.2)".
3. **Allow rules** of B8 (narrow, our own branches and worktree only).
4. **Conductor runs in the main checkout** on the milestone branch (the main checkout must stay free while it runs); the owner reads results there and opens PRs.
5. **E4 closed as replaced**; `tools/lanes.mjs` stays (isolation), `/fanout` and `/integrate` become legacy.

## 7. Sessions

| Session | Scope | Done when |
| - | - | - |
| A-1 · Core tools | B1 backlog, B2 gate, B3 stop hook + context-guard mode, B8 settings | `npm run test:tools` green with the new tests; `backlog.mjs sync` on M3 lists the open ACs; stop hook verified on fake transcripts |
| A-2 · Roles and learning | B4 conductor skill, B5 role prompts, B6 playbook, B7 metrics + judge, B9 docs; dry run with `--cap 1` on one small AC (F-07.2 Mark reviewed) | one item goes todo → done unattended, `items.jsonl` row written, one playbook delta |
| A-3 · Pilot | `/autopilot start M3 --cap 6` on the remaining M3 items (Mark reviewed UI, decisions 12–15 tasks, F-07.9, F-04.1); then compare §1 metrics, first curate + retro | §1 targets checked and reported in PROGRESS; E10 judged |

Later (not in A-1…A-3): a golden set of 3 already-done ACs re-run from their parent commit to compare process versions (end-state evaluation); pipelining the test author of item N+1 alongside the implementer of item N.

## 8. Risks

| Risk | Mitigation |
| - | - |
| Cost per AC higher than a session | accepted; measured per role in `items.jsonl`; Sonnet for tests, reflect and UI (Opus for tests in E16, reverted) |
| Decisions drift in the wrong direction | spec, mocks and design system first, then named UI/UX principles with a "why"; the fresh reviewer judges open UI/UX choices; logged in `DECISIONS-PENDING.md`; an owner veto at any time → rework item |
| Classifier blocks stall the loop | allow rules; blocked commands are reported, never worked around |
| Agents game the tests | lock + gate diff check; reviewer sees the tests and the diff |
| Playbook bloat / context collapse | delta-only edits, tag selection ≤ 1.5k tokens, curate prunes |
| Conductor context grows | heavy work in subagents; verdicts only; compaction; context guard in continue mode |
| `/app` live checks clash on ports | not in the loop: the live checker runs at the start of "Closing", after the run's items, in the main checkout (port 1420, CDP 9222; the loop's e2e use 1510) |

## 9. Build status (A-4, 2026-10-14)

**Built** (B1–B9; `node --test tools/autopilot-*.test.mjs`, 39 tests): backlog with one decision row per item, gate with `--dispute`, run state, worktree and Stop hook, the seven role prompts composed by `prompt.mjs`, playbook, outcome metrics with tokens per role from the subagent transcripts, judge, the conductor skill. The owner applied the Stop hook and the allow rules in `.claude/settings.json` (6917cfa) and allowed the role files (40f612b); CLAUDE.md "How to work" 11 and the memory "Go with recommended" (P-7).

**Verified in the first run** (A-3, `ap-20261014-0830`): two items built and merged without the owner. F-02.5: tests → implement → review → gate, first pass. F-04.1: tests → implement → review (1 severe finding, an accepted test dispute) → fix round 1 → gate, first pass. Proven along the way: the Stop hook carrying the loop to the next item, `backlog sync/next/set`, `worktree ready/done`, the context pack offering playbook lessons, reflection with `playbook add/rate/tick`, `record.mjs`, and the stop on the decision cap. Gate first pass 2/2, 0 non-negotiable violations merged. Fixed after the run: token counting (f0c1f34), test disputes in the gate (88558bc), one decision row per item (88b2606), prompts from `prompt.mjs` instead of hand-filled placeholders (912bbde).

**Verified in the second run** (A-4, `ap-20261014-1246`, cap 6): six items built and merged without the owner (F-04.3, F-05.5, F-06.5, F-06.6, F-06.9, F-07.1), gate first pass 6/6, 0 fix rounds, 0 non-negotiable violations merged. Proven: purely screen (`ui`) items with the Sonnet implementer and the design-check structure mode inside the loop (F-06.6, F-07.1); `prompt.mjs` composing every role prompt (tests, implement, review, reflect, curate) with no missing field; one decision row per item (D-07…D-10, points (1), (2)); the curator called after 5 recorded items (it ran `playbook.mjs curate`, found nothing to prune, merge or promote and made no commit, reason in `.autopilot/curate/curate-1.json`). New in this run: the conductor skipped the implementer when the test author found the criterion already built and the new tests passed on the base (F-05.5, F-06.9); the fresh reviewer and the gate still ran. Found: the Stop hook counts continuations, so `--cap N` offers item N+1 (the conductor stopped at 6); `playbook add` raises `seen` only for an identical text and the reflector words every lesson anew, so the 3× promotion does not trigger in practice (24 entries, all seen ×1).

**Run ap-20261015-1102** (2 items, 12.9M tokens, 14 and 31 min): F-17.1 (second attempt after a failed live check) built, merged (9163bf3) and passed its live check in the real app; F-09.5 merged (b4126f6), waits for `npm run eval:claude`. Found and fixed after the run: the conductor copied the failed live check into `context.md` by hand, so the tests, implement and fix prompts now get the item note and a line per `attempt-N` folder (`{{history}}`); a result `live` (built, only the check in the app left) for the reflector and `record.mjs`, which had to say `partial`; the accepted test dispute of attempt 1 was not applied in attempt 2 until the conductor added `--dispute`, so the backlog now remembers it per item (`backlog.mjs set <id> --dispute file@sha`, from the fix answer's `testChange`) and the gate applies it in every call; the passing gate call overwrote the failed `gate-1.json` (gate first pass recorded as true), so the gate never overwrites a verdict (next free number) and `record.mjs` takes the first call; the live role may run `npm run eval:claude`; its model rule was wrong (the app has a default model per task, F-18.3; the title-bar chip shows the task of the screen and is no precondition; a click on "Review" started an uncached plan on Opus), so it now uses cached MRs, logs every uncached run in its notes, and never changes Settings.

**Never run yet** (still unproven after three runs):
1. A second fix round, and the statuses `blocked` (gate failed twice) and `needs-owner` (with the push notification).
2. The curator writing the "Rules learned" of a role file: it does so only with `playbook.mjs promote <id> <role> "<rule>"`, a command the `node tools/autopilot/*` allow rule covers, so no approval is needed (owner, 2026-10-15: nothing approved by hand). Since E17 (2026-10-15) a proposal is a lesson seen 3× or helpful 3× and never harmful (6 proposals waiting; 19 entries on `hold` because E18 group B rules replace them), the reflector confirms an existing lesson by id (`{"same": "P-xxx"}`) instead of rewording it, and the curator merges same-meaning lessons with `playbook.mjs merge`.
3. The retro every 10 items with `judge.mjs` keep/revert verdicts.
4. The planner (a milestone without `docs/plans/<Mx>.md`).
5. The token budget `--budget`: it counts the tokens of the run (`items.jsonl` rows of the run id), not of a day; never set or reached.
6. A rework item after a veto in a real run.
7. The live checker's tokens in `items.jsonl` (no item row; not counted against `--budget`). The role itself ran in ap-20261015-0623 (F-09.6 pass) and ap-20261015-1102 (F-17.1 pass, F-09.5 skipped: the eval was outside its limits then); it has not yet run `npm run eval:claude`.

## Sources

Anthropic: [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), [effective harnesses for long-running agents](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks), [auto mode](https://claude.com/blog/auto-mode). Cognition: [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents), [Multi-agents: what's actually working](https://cognition.com/blog/multi-agents-working). [ACE, arXiv 2510.04618](https://arxiv.org/pdf/2510.04618). [ngrok: bmo](https://ngrok.com/blog/bmo-self-improving-coding-agent). [The Register on auto mode limits](https://www.theregister.com/a/5285326).
