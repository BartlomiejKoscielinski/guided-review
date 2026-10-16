---
name: retro
description: Process retrospective for Guided Review - read the session metrics (tokens, context tax, time), judge the open experiments in docs/process/IMPROVEMENTS.md, and add or apply at most three small improvements; at the end of a milestone also review the whole autopilot mechanism. Use when /handoff says a retro is due, at the end of a milestone ("milestone Mx"), or when the user says /retro.
argument-hint: [optional focus, e.g. "design-check", "verify time" or "milestone M5"]
# Forked so the metrics never enter the main session. Opus (E21): its verdicts keep or revert process changes, and on Sonnet 4 of 6 needed redoing.
context: fork
background: false
model: opus
effort: medium
---

Focus (optional): $ARGUMENTS

Budget: at most ~15 tool calls (~30 with the mechanism review). The report is built to be read once; don't open transcripts.

**Priorities (owner, 2026-10-16): quality, then time, then cost.** Rank problems and pick experiments in this order. Quality = the product works and matches the spec: severe and normal review findings, fix rounds, failed live checks, vetoed decisions, defects found later in code the autopilot merged. Time = wall time per finished criterion (`pace`, `wallMin`) and tool time. Cost = tokens and context. A change that saves time or tokens but makes quality worse is reverted, whatever its own metric says.

1. Data (one call): `node tools/metrics/report.mjs --last 8 && node tools/metrics/report.mjs --retro-due`. Read `docs/process/IMPROVEMENTS.md`.
2. Judge every **open** experiment against its metric with the numbers from the report (sessions after the experiment's date only). Mark it `kept` (target met or clearly better, and no higher priority worse), `reverted` (no effect or worse; undo the change), or `open` with a note when there are fewer than 3 sessions (or 3 items, for an autopilot metric) of data. Move kept/reverted rows to Closed with the measured numbers. A row whose date reads "(starts when <ID> is judged)" waits for that judgement: once you mark <ID> kept or reverted, carry out the row's start step in the same retro and report it.
3. Look at the rule hits (R1–R11) that no experiment covers yet. Pick at most **three**, quality first, then time, then token cost, and write each as an experiment: change, metric with baseline from the report, target, and a guard that the higher priorities stay as they are. Prefer, in this order: a threshold or budget change in an existing skill; a script that prints one compact report instead of many calls; a hook; a new skill only when the same multi-step pattern shows up in 3+ sessions.
4. **Mechanism review**, only when the focus starts with `milestone` (the autopilot Closing and `/handoff` pass `milestone <Mx>` when a milestone is complete). Step back from single metrics and ask what in the whole loop (roles and their order, item size, models, gate, tests ahead, live checks, playbook, conductor) should change so the next milestone gets better quality in less time. Data, one call each:
   - `node tools/autopilot/judge.mjs --summary --milestone <Mx>`: per item result, wall minutes, fix rounds, findings, tokens, and the milestone means; compare with the previous milestone (`--milestone <M(x-1)>`).
   - What the fix rounds were about: the `findings` of `.autopilot/items/<id>/review.json` and the failed checks of `gate-N.json` for the milestone's items (`grep -h '"text"\|"name"' …`, not whole files); group them into a few classes (state lost on remount, a layout or line kind not covered, path or rename, load timeout, …) and count each class.
   - Follow-ups the roles proposed outside their item: `grep -h -i -o '"notes": "[^"]*follow[^"]*' .autopilot/items/*/*.json | cut -c1-300`.
   - Live checks that failed (`grep -n 'live check failed' docs/process/backlog.json`) and vetoed decisions (`grep -n 'vetoed' docs/process/DECISIONS-PENDING.md`).
   - `planned` experiments and the `## Ideas` list in IMPROVEMENTS.md.
   Then write up to **five** candidate changes to the mechanism, each with the evidence (item IDs, numbers), the expected effect on quality, time and cost, and its size. Start at most **two** as experiments (step 4 rules for applying them; bigger ones as `planned` with what they need), the ones with the largest expected quality gain first, then time. Put the others in `## Ideas` of IMPROVEMENTS.md (one line each: date · idea · evidence). Re-rank the whole `## Ideas` list and every `planned` experiment: start it, keep it with a reason, or drop it; nothing stays `planned` for more than one milestone without a reason in its row.
5. Apply the experiments that only touch process tooling (`tools/metrics/`, `tools/*.mjs`, `tools/autopilot/`, `.claude/skills/`, `.claude/autopilot/roles/`, `.claude/settings*.json` hooks and denies) and are small (≲ 100 lines). List bigger ones as `planned` with what they need. Never change the non-negotiables in `CLAUDE.md`, product docs (`docs/0*.md` other than process notes), or app code. If a rule in `tools/metrics/suggest.mjs` misfired, tune its threshold and say so in the row.
6. Update `Last retro:` to the current UTC time, minutes precision (`2026-10-14T09:30Z`); a bare date counts as the end of that day; after a mechanism review also `Last mechanism review: <Mx> <time>`. Run `node --test tools/metrics.test.mjs` if you touched `tools/metrics/`, `npm run test:tools` if you touched `tools/autopilot/`.
7. Do not commit; the main session does. Return at most 15 lines (25 with the mechanism review): experiments judged (ID · result · numbers), new experiments (ID · change · metric), the mechanism candidates (one line each, started or to Ideas), files changed, anything that needs the owner.
