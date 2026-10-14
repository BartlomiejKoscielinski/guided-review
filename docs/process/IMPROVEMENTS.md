# Process improvements

The feedback loop for how we build Guided Review (not the product). Data: `node tools/metrics/report.mjs` (ledger `.metrics/sessions.jsonl`, from the Claude Code transcripts; `.verify/timings.jsonl` for verify steps). `/retro` reads the numbers, judges the open experiments below, and adds at most three new ones. Every change to the process is an experiment with a metric and a baseline, so it can be kept or reverted on evidence.

Last retro: 2026-10-14T09:30Z (24 sessions)

## Baseline (2026-10-13, 10 M3 sessions 3b–3e)

- Main thread: 55–132 turns, base context 53–54k, max context 150–243k (10 of 10 over 150k), cache read 6.5–26M per session (median ≈ 12M).
- Context tax: ≈ 84% of the top tax is reading files through the shell (`sed` 12.0M, `cat` 7.9M, `grep` 4.7M over 12 sessions).
- `/design-check`: 66 turns and 5.5M cache read per run (the pre-bd9897a skill: bd9897a was committed on the M2 branch after M3 branched and only reached M3 in dc775d4).
- Tool time over 12 sessions: verify 38 min, design-check 18 min, shell loops 16 min.

## Experiments

| ID | Date | Change | Metric (baseline → target) | Status |
| - | - | - | - | - |
| E1 | 2026-10-13 | `/design-check` structure mode by default (ADR-026) on the one-run script (bd9897a → dc775d4, 4900d5a) | design-check turns/run 66 → ≤ 15; cache read/run 5.5M → ≤ 1.5M | open |
| E5 | 2026-10-13 | `/handoff` rule: next-session prompt fits ~100k context, max 3 tasks; the session-log row records `tasks x/y` (`.claude/skills/handoff/SKILL.md`) | prompt tasks done / planned per session (P-2: stopped by the guard before its last tasks; P-3, 5 tasks before E5: all but e2e on 1420, port busy) → all, before the 120k warning in ≥ 4 of 5 sessions. Not "sessions over 150k": the guard (E2) caps that by itself. | open |
| E6 | 2026-10-13 | Playwright reporter always `line` (`playwright.config.ts`; was `list` outside CI); R2 hit 9× / 41k tax | `Bash: npx playwright` tax per session 41k → ≤ 10k | open |
| E7 | 2026-10-14 | `/integrate` step 7: `lanes.mjs remove` without `--delete-branch`, no stash; branches listed for the owner (classifier blocks branch deletion and stash drops) (`.claude/skills/integrate/SKILL.md`) | failed tool calls per integration (R9: 14 in the pilot) → ≤ 3 | open |
| E8 | 2026-10-14 | `/integrate` review budget: `/code-review medium` once per lane, `git diff --stat` first, handoff if context > ~120k before verify (same file) | integrator cache read 17.4M → ≤ 8M; sub-turns 107 → ≤ 50; max context 178k → ≤ 150k | open |
| E9 | 2026-10-14 | Context guard (E2) raised by the owner: wrap-up warning 120k → 200k, handoff-now 160k → 240k (`tools/metrics/context-guard.mjs`); the E5 prompt budget (~100k, max 3 tasks) is unchanged | prompt tasks done / planned per session (P-7: 2/3, guard during task 3) → all planned tasks done; cache read per session (P-7: 6.4M); sessions over 200k | open |
| E10 | 2026-10-14 | Autopilot (`docs/process/AUTOPILOT.md`): unattended conductor loop, one AC at a time (test author → implementer → fresh reviewer → deterministic gate → reflection), playbook deltas, outcome metrics in `.metrics/items.jsonl`, experiments judged by `tools/autopilot/judge.mjs` | ACs per unattended run 0 → ≥ 5; gate first pass ≥ 60%; tokens per AC vs P-x sessions (6–12M for 1–3 ACs); non-negotiable violations merged 0 | open: built in P-7. **Pilot A-3** (run ap-20261014-0830, cap 6): 2 ACs done unattended (F-02.5, F-04.1), then the loop stopped on the provisional-decision limit (6 > 5, D-01…D-06); gate first pass 2/2; 1 severe + 1 normal finding caught by the reviewer before merge (F-04.1, 1 fix round, 1 accepted test dispute); 0 non-negotiable violations merged, branch green after both ff-merges; playbook P-002, P-003 reused and rated helpful. Cost: 40.5M cache read for the session (main thread 58 turns, max 133k); the roles 4.4M (F-02.5) and 31.1M (F-04.1, with the fix round) by the transcripts, worse than P-x for F-04.1. The Agent `subagent_tokens` (276k / 713k) under-counted it ~40×; `record.mjs` now reads the transcripts and the two rows were recomputed. Wall time 23 / 69 min per AC. Fixes before the next run: decision granularity vs the limit, token accounting, locked-test list and accepted disputes in the gate |

## Closed

| ID | Result | Numbers |
| - | - | - |
| E3 | kept | Base context 53-54k (15 of 17 sessions; 71k in the first two) → 43k in both sessions after the deny list; target ≤ 45k met. |
| E2 | kept | 8 sessions since 358ba79: over 150k in 1 of 8 (the integrator, 178k); P-3 147k, rest 50-105k; target ≤ 3/10 met. |
| E4 | replaced | Pilot: lanes 8/15 min at 1.5M cache read each, but the integrator 17.4M (max 178k) ate the savings, the contract step was never exercised, and parallel writers are the pattern the research advises against (Cognition 2026, Anthropic). Replaced by E10 (single-threaded writes, parallel reading only); `tools/lanes.mjs` stays for isolation, `/fanout` and `/integrate` are legacy. |
