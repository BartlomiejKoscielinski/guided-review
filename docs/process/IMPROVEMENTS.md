# Process improvements

The feedback loop for how we build Guided Review (not the product). Data: `node tools/metrics/report.mjs` (ledger `.metrics/sessions.jsonl`, from the Claude Code transcripts; `.verify/timings.jsonl` for verify steps). `/retro` reads the numbers, judges the open experiments below, and adds at most three new ones. Every change to the process is an experiment with a metric and a baseline, so it can be kept or reverted on evidence.

Last retro: 2026-10-13

## Baseline (2026-10-13, 10 M3 sessions 3b–3e)

- Main thread: 55–132 turns, base context 53–54k, max context 150–243k (10 of 10 over 150k), cache read 6.5–26M per session (median ≈ 12M).
- Context tax: ≈ 84% of the top tax is reading files through the shell (`sed` 12.0M, `cat` 7.9M, `grep` 4.7M over 12 sessions).
- `/design-check`: 66 turns and 5.5M cache read per run (the pre-bd9897a skill: bd9897a was committed on the M2 branch after M3 branched and only reached M3 in dc775d4).
- Tool time over 12 sessions: verify 38 min, design-check 18 min, shell loops 16 min.

## Experiments

| ID | Date | Change | Metric (baseline → target) | Status |
| - | - | - | - | - |
| E1 | 2026-10-13 | `/design-check` structure mode by default (ADR-026) on the one-run script (bd9897a → dc775d4, 4900d5a) | design-check turns/run 66 → ≤ 15; cache read/run 5.5M → ≤ 1.5M | open |
| E2 | 2026-10-13 | Context guard: PostToolUse hook warns at 120k (wrap up) and 160k (handoff now) (`tools/metrics/context-guard.mjs`) | sessions over 150k 10/10 → ≤ 3/10; cache read above 150k per session | open |
| E3 | 2026-10-13 | Deny unused desktop tools in `.claude/settings.local.json` (Artifact*, docs and visualize MCP) | base context 53k → ≤ 45k | open |
| E4 | planned | Context packs for lanes (`tools/context-pack.mjs`) and parallel lanes in worktrees | reading share of tax 84% → ≤ 50%; median cache read/session 12M → ≤ 7M; wall time per milestone | planned |

## Closed

(none yet)
