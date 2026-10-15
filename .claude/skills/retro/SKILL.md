---
name: retro
description: Process retrospective for Guided Review - read the session metrics (tokens, context tax, time), judge the open experiments in docs/process/IMPROVEMENTS.md, and add or apply at most three small improvements. Use when /handoff says a retro is due, at the end of a milestone, or when the user says /retro.
argument-hint: [optional focus, e.g. "design-check" or "verify time"]
# Forked so the metrics never enter the main session. Opus (E21): its verdicts keep or revert process changes, and on Sonnet 4 of 6 needed redoing.
context: fork
background: false
model: opus
effort: medium
---

Focus (optional): $ARGUMENTS

Budget: at most ~15 tool calls. The report is built to be read once; don't open transcripts.

1. Data (one call): `node tools/metrics/report.mjs --last 8 && node tools/metrics/report.mjs --retro-due`. Read `docs/process/IMPROVEMENTS.md`.
2. Judge every **open** experiment against its metric with the numbers from the report (sessions after the experiment's date only). Mark it `kept` (target met or clearly better), `reverted` (no effect or worse; undo the change), or `open` with a note when there are fewer than 3 sessions of data. Move kept/reverted rows to Closed with the measured numbers. A row whose date reads "(starts when <ID> is judged)" waits for that judgement: once you mark <ID> kept or reverted, carry out the row's start step in the same retro and report it.
3. Look at the rule hits (R1–R11) that no experiment covers yet. Pick at most **three** with the largest token or time cost and write each as an experiment: change, metric with baseline from the report, target. Prefer, in this order: a threshold or budget change in an existing skill; a script that prints one compact report instead of many calls; a hook; a new skill only when the same multi-step pattern shows up in 3+ sessions.
4. Apply the experiments that only touch process tooling (`tools/metrics/`, `tools/*.mjs`, `.claude/skills/`, `.claude/settings*.json` hooks and denies) and are small (≲ 100 lines). List bigger ones as `planned` with what they need. Never change the non-negotiables in `CLAUDE.md`, product docs (`docs/0*.md` other than process notes), or app code. If a rule in `tools/metrics/suggest.mjs` misfired, tune its threshold and say so in the row.
5. Update `Last retro:` to the current UTC time, minutes precision (`2026-10-14T09:30Z`); a bare date counts as the end of that day. Run `node --test tools/metrics.test.mjs` if you touched `tools/metrics/`.
6. Do not commit; the main session does. Return at most 15 lines: experiments judged (ID · result · numbers), new experiments (ID · change · metric), files changed, anything that needs the owner.
