# Process improvements

The feedback loop for how we build Guided Review (not the product). Data: `node tools/metrics/report.mjs` (ledger `.metrics/sessions.jsonl`, from the Claude Code transcripts; `.verify/timings.jsonl` for verify steps). `/retro` reads the numbers, judges the open experiments below, and adds at most three new ones. Every change to the process is an experiment with a metric and a baseline, so it can be kept or reverted on evidence.

Last retro: 2026-10-13T20:19Z (17 sessions)

## Baseline (2026-10-13, 10 M3 sessions 3b–3e)

- Main thread: 55–132 turns, base context 53–54k, max context 150–243k (10 of 10 over 150k), cache read 6.5–26M per session (median ≈ 12M).
- Context tax: ≈ 84% of the top tax is reading files through the shell (`sed` 12.0M, `cat` 7.9M, `grep` 4.7M over 12 sessions).
- `/design-check`: 66 turns and 5.5M cache read per run (the pre-bd9897a skill: bd9897a was committed on the M2 branch after M3 branched and only reached M3 in dc775d4).
- Tool time over 12 sessions: verify 38 min, design-check 18 min, shell loops 16 min.

## Experiments

| ID | Date | Change | Metric (baseline → target) | Status |
| - | - | - | - | - |
| E1 | 2026-10-13 | `/design-check` structure mode by default (ADR-026) on the one-run script (bd9897a → dc775d4, 4900d5a) | design-check turns/run 66 → ≤ 15; cache read/run 5.5M → ≤ 1.5M | open |
| E2 | 2026-10-13 | Context guard: PostToolUse hook warns at 120k (wrap up) and 160k (handoff now) (`tools/metrics/context-guard.mjs`) | sessions over 150k 10/10 → ≤ 3/10; cache read above 150k per session | open: reopened after review (the retro closed it on n=2, against its own < 3 rule). After 358ba79: P-2 137k, P-3 warned at 120k, handed off at 123k (a review fix continued it), one 51k session that never reached the guard. Judge at the next retro. |
| E5 | 2026-10-13 | `/handoff` rule: next-session prompt fits ~100k context, max 3 tasks; the session-log row records `tasks x/y` (`.claude/skills/handoff/SKILL.md`) | prompt tasks done / planned per session (P-2: stopped by the guard before its last tasks; P-3, 5 tasks before E5: all but e2e on 1420, port busy) → all, before the 120k warning in ≥ 4 of 5 sessions. Not "sessions over 150k": the guard (E2) caps that by itself. | open |
| E6 | 2026-10-13 | Playwright reporter always `line` (`playwright.config.ts`; was `list` outside CI); R2 hit 9× / 41k tax | `Bash: npx playwright` tax per session 41k → ≤ 10k | open |
| E4 | 2026-10-13 | Context packs for lanes (`tools/context-pack.mjs`) and parallel lanes in worktrees (`tools/lanes.mjs`, `/fanout`, `/integrate`; contract = plan `## Lanes` + IPC types) | reading share of tax 84% → ≤ 50%; median cache read/session 12M → ≤ 7M; wall time per milestone | open: tooling done in P-2–P-4, first measured run = the pilot of 2 lanes on M3 (P-5) |

## Closed

| ID | Result | Numbers |
| - | - | - |
| E3 | kept | Base context 53-54k (15 of 17 sessions; 71k in the first two) → 43k in both sessions after the deny list; target ≤ 45k met. |
