# Autopilot · implementation plan (E10)

Status: **draft, awaiting owner approval** (2026-10-14). Replaces E4 (parallel writer lanes) as the default way of building milestones. Cost of 3–4 agents per acceptance criterion: accepted by the owner.

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
owner ──(async: reads results, vetoes provisional decisions, answers needs-owner)──┐
                                                                                    v
Conductor session (main checkout, milestone branch, Opus)            docs/process/DECISIONS-PENDING.md
  loop: backlog next → pipeline(item) → gate → reflect → record → (curate/retro every N)
  Stop hook: continue while ready items ∧ budget ∧ iterations < cap ∧ no .autopilot/STOP
        │ foreground Agent calls, one role at a time (reading roles may run in parallel)
        v
  Worktree ../gr-ap, branch ap/<item> from the milestone branch
    1 Test author (Sonnet)  → failing tests 'F-xx.n …' from spec/screen/mock only → commit, tests locked
    2 Implementer (Opus core / Sonnet UI) → code until tests pass, /verify → commit
    3 Reviewer (Opus, fresh)  → findings JSON (+ /design-check structure for UI)
       ↺ implementer fix round (max 2)
    4 Gate (script, no LLM)    → verify (+e2e for UI), audit, locked tests unchanged, owns, rule greps
                               → ff-merge into the milestone branch, tick PROGRESS
    5 Reflector (Haiku)        → 0–3 playbook deltas
```

### 3.1 State (files)

| File | Committed | Content |
| - | - | - |
| `docs/process/backlog.json` | yes | Items synced from `PROGRESS.md` + `plans/<Mx>.md`: `{id, milestone, title, kind: core\|ui\|docs\|mixed, deps[], status: todo\|tests\|impl\|review\|done\|blocked\|needs-owner, attempts, lockSha?, branch?, note}`. JSON, not Markdown (agents mangle it less). Only the conductor and `backlog.mjs` write it. |
| `docs/process/playbook.json` | yes | `[{id, tags[], text, helpful, harmful, created, lastUsed, source}]`; tags = path globs, item kinds, roles. |
| `docs/process/DECISIONS-PENDING.md` | yes | Provisional decisions: `ID · date · item · question · chosen (recommended) · alternatives · reversible · status (provisional/accepted/vetoed)`. |
| `.metrics/items.jsonl` | yes | One row per item attempt: tokens per role, wall time, gate first pass, rounds, findings by severity, result, escaped defects (filled later). |
| `.autopilot/run.json` | no | `{runId, startedAt, iterations, cap, budgetTokens, milestone}`; `.autopilot/STOP` = kill switch. |
| `.autopilot/items/<id>/` | no | Role verdicts (`tests.json`, `impl.json`, `review.json`, `gate.json`), the context pack. |

### 3.2 Decision policy (replaces "stop and ask" for the autopilot)

- **Spec unclear or contradicting a mock, reversible**: pick the recommended option, add a row to `DECISIONS-PENDING.md`, continue. Items depending on a provisional decision are not started while more than 5 rows are unreviewed.
- **Needs-owner** (item skipped, push notification): anything touching the non-negotiables of `CLAUDE.md` (Claude flags, security, secrets, company data, GitLab write actions without a click), real company data or a field visit (ADR-019), changing an ADR, new dependencies, deleting tests.
- **Veto** by the owner (status `vetoed` in the file): the next sync adds a rework item.

### 3.3 Safety rails

- Iteration cap per run (default 12 items), daily token budget from the metrics ledger, kill switch `.autopilot/STOP`.
- Max 2 fix rounds and 2 attempts per item → `blocked` with a report, next item.
- No destructive git outside `../gr-ap` and the `ap/*` branches; nothing is pushed; the owner opens PRs.
- Self-modification allowlist: retro/curator may change `docs/process/playbook.json`, `.claude/skills/**` (except non-negotiable text), `tools/autopilot/**`. Never `CLAUDE.md` non-negotiables, `docs/0*.md` decisions, security rules.
- Explicit `allow` rules for the few operations the classifier blocks (auto mode falls back to manual prompts after 3 blocks in a row or 20 per session).

## 4. Build list

| # | Component | Files | Tests |
| - | - | - | - |
| B1 | Backlog: `sync` (PROGRESS unchecked + plan AC table → items, keep statuses), `next` (first `todo` with deps done, not blocked by >5 provisional), `set <id> <status> [--note]` | `tools/autopilot/backlog.mjs`, `tools/autopilot/backlog-lib.mjs` | `tools/autopilot-backlog.test.mjs` (fixture PROGRESS/plan) |
| B2 | Gate: verify (`--e2e <spec>` for UI), `audit --milestone`, locked tests unchanged since `lockSha` (`git diff --name-only lockSha..HEAD -- <test files>`), changed files within the item's kind, rule greps (`--bare`, `--dangerously-skip-permissions`, `unwrap()` outside tests, `glpat-` + 20 chars, hex colors in components), ff-merge, PROGRESS tick with SHA; JSON verdict | `tools/autopilot/gate.mjs` | `tools/autopilot-gate.test.mjs` (throwaway repo) |
| B3 | Stop hook: binds to the conductor by the marker `AUTOPILOT <runId>` in the last assistant message (transcript tail, as in `context-guard.mjs`); blocks the stop with "next item" while the conditions hold; otherwise allows it. Context guard: in a marked session it says "write state, continue" instead of "/handoff" | `tools/autopilot/stop-hook.mjs`, `tools/metrics/context-guard.mjs`, `.claude/settings.json` | `tools/autopilot-hook.test.mjs` (fake transcripts) |
| B4 | Conductor skill `/autopilot start\|status\|stop [Mx] [--cap N]`: run file, keep-awake, loop body, role calls with fixed prompts, verdict handling, notifications, curate every 5 items, retro every 10 | `.claude/skills/autopilot/SKILL.md` | dry run (B7) |
| B5 | Role prompts (objective, inputs, output JSON, boundaries, done condition): tests, implement, review, fix, reflect, curate, plan (milestone planning when the backlog of the milestone is empty) | `.claude/autopilot/roles/*.md` | dry run |
| B6 | Playbook: `add`, `select --tags` (into the context pack, ≤ 1.5k tokens), `score <id> helpful\|harmful`, `curate` (dedupe, promote 3× recurring to a skill rule proposal, prune unused 30 items) | `tools/autopilot/playbook.mjs`, `tools/context-pack.mjs --playbook` | `tools/autopilot-playbook.test.mjs` |
| B7 | Outcome metrics + judge: `items.jsonl` rows from verdicts; `judge.mjs` compares an experiment's metric over the next K = 5 items with the 5 before → keep / revert (`git revert <experiment sha>`) | `tools/autopilot/record.mjs`, `tools/autopilot/judge.mjs`, `tools/metrics/report.mjs --items` | `tools/autopilot-judge.test.mjs` |
| B8 | Settings: Stop hook registration; `allow` rules: `git worktree remove ../gr-ap`, `git branch -d ap/*`, `git branch -d m*/*` merged lanes; `test:tools` glob covers the new tests | `.claude/settings.json`, `package.json` | `npm run test:tools` |
| B9 | Docs: CLAUDE.md "How to work" (autopilot mode + decision policy), IMPROVEMENTS (E4 closed as replaced, E10 open), `/fanout` and `/integrate` marked legacy | `CLAUDE.md`, `docs/process/IMPROVEMENTS.md`, skills | `/audit` unaffected |

No new npm or cargo dependencies (Node built-ins only).

## 5. Pipeline details

- **Startup routine of every role**: `cd ../gr-ap`, `git log --oneline -5`, read its inputs only, `node tools/verify.mjs --only typecheck` as a smoke check (implementer only).
- **Test author** reads: the AC text, the `S-xx` section and mock crop (UI), the plan row; never the implementation. Writes Vitest/Rust/Playwright tests named with the AC ID that fail for the right reason; commits; the conductor stores `lockSha` and the test file list. A test it cannot write meaningfully (live check, field visit) → the item keeps a `manual` note, the gate skips the lock check.
- **Implementer** reads the context pack (`context-pack.mjs <AC> --plan <Mx> --files … --playbook`), may not change locked test files (gate enforces; a wrong test → `testDispute` in its verdict, decided by the reviewer).
- **Reviewer** gets `git diff <milestone>...ap/<item>`, the AC text and `CLAUDE.md` non-negotiables; returns `{findings: [{severity: severe|normal|nit, file, line, text}], testDispute?: accept|reject}`; UI items also run `/design-check` structure mode. Severe or normal findings → one fix round.
- **Gate** is deterministic; its JSON verdict is the only thing that decides merge.
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
| Cost per AC higher than a session | accepted; measured per role in `items.jsonl`; Haiku for reflect, Sonnet for tests and UI |
| Provisional decisions pile up in the wrong direction | cap of 5 unreviewed; veto → rework item |
| Classifier blocks stall the loop | allow rules; blocked commands are reported, never worked around |
| Agents game the tests | lock + gate diff check; reviewer sees the tests and the diff |
| Playbook bloat / context collapse | delta-only edits, tag selection ≤ 1.5k tokens, curate prunes |
| Conductor context grows | heavy work in subagents; verdicts only; compaction; context guard in continue mode |
| `/app` live checks clash on ports | not in the loop; a separate conductor step after a milestone's items are done |

## Sources

Anthropic: [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), [effective harnesses for long-running agents](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks), [auto mode](https://claude.com/blog/auto-mode). Cognition: [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents), [Multi-agents: what's actually working](https://cognition.com/blog/multi-agents-working). [ACE, arXiv 2510.04618](https://arxiv.org/pdf/2510.04618). [ngrok: bmo](https://ngrok.com/blog/bmo-self-improving-coding-agent). [The Register on auto mode limits](https://www.theregister.com/a/5285326).
