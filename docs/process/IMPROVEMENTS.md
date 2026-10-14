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
| E4 | 2026-10-13 | Context packs for lanes (`tools/context-pack.mjs`) and parallel lanes in worktrees (`tools/lanes.mjs`, `/fanout`, `/integrate`; contract = plan `## Lanes` + IPC types) | reading share of tax 84% → ≤ 50%; median cache read/session 12M → ≤ 7M; wall time per milestone | open: pilot measured (2 lanes on M3): lanes 8 and 15 min, 1.5M cache read each, max context ≤ 105k, base 31k (tokens 155k/137k; 79k third): lanes meet the target. Integrator 7 min tool time but 68+107 turns, 17.4M cache read, max 178k, reading share 94%: the integrator eats the savings. P-6 gate rejected because P-5 never started the lanes; milestone wall time still unmeasured. Judge after a full run (E8 targets the integrator). |
| E7 | 2026-10-14 | `/integrate` step 7: `lanes.mjs remove` without `--delete-branch`, no stash; branches listed for the owner (classifier blocks branch deletion and stash drops) (`.claude/skills/integrate/SKILL.md`) | failed tool calls per integration (R9: 14 in the pilot) → ≤ 3 | open |
| E8 | 2026-10-14 | `/integrate` review budget: `/code-review medium` once per lane, `git diff --stat` first, handoff if context > ~120k before verify (same file) | integrator cache read 17.4M → ≤ 8M; sub-turns 107 → ≤ 50; max context 178k → ≤ 150k | open |

## Closed

| ID | Result | Numbers |
| - | - | - |
| E3 | kept | Base context 53-54k (15 of 17 sessions; 71k in the first two) → 43k in both sessions after the deny list; target ≤ 45k met. |
| E2 | kept | 8 sessions since 358ba79: over 150k in 1 of 8 (the integrator, 178k); P-3 147k, rest 50-105k; target ≤ 3/10 met. |
