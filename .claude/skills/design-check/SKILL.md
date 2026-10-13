---
name: design-check
description: Compare an implemented screen of Guided Review with its design mock - by default a structure check (copy, design rules, regions; no pixel work), with "pixel" the full polish pass. Use after building or changing UI, or when the user says /design-check S-xx.
argument-hint: [screen id, e.g. S-05] [pixel]
# Runs in its own subagent so screenshots, crops and mock text never enter the main session.
# Not in the background: it edits files, and the caller needs the result before committing.
# Sonnet: comparing crops and fixing CSS does not need Opus; every turn re-reads ~60k of context.
context: fork
background: false
model: sonnet
effort: medium
---

Screen: $ARGUMENTS

**Mode.** Without `pixel` in the arguments this is the **structure check** used during milestones (owner, 2026-10-13: pixel polish happens in one UI pass at the end of implementation, roadmap M11). It checks only what is cheap now and expensive later: exact copy, the design rules, the right regions and components in the right places. Sizes, spacing, font sizes and weights, small offsets are **not** issues in structure mode; don't report or fix them. With `pixel` it is the full pass: everything below plus the pixel heatmap, crops and size/spacing differences.

Budget: **structure: at most ~10 tool calls and 1 fix round; pixel: ~20 calls and 2 fix rounds.** Every call costs a full turn of context, so chain shell commands in one call and never explore the mock or the report with many small `sed`/`grep` calls. Never Read a whole `*.dc.html` mock or a full 1600×1000 PNG; read docs by section only.

1. Context (one call): the `S-xx` section of `docs/02-screens.md` (`grep -n '^## '`, then Read with offset/limit). Look up `03-design-system.md` only for a token or rule in question.
2. Gather everything with one command (it starts the mock dev server through Playwright if needed):
   `node tools/mock-preview/design-check.mjs Sxx` (structure) or `… Sxx --pixel` (pixel); `--states a,b` to limit, `--no-shots` to reuse captures.
   For every state in `tests/e2e/design-shots.spec.ts` it captures the implementation, renders the mock state from `tools/mock-preview/states.json`, and prints a **DOM comparison** by text: copy differences, font family / uppercase / token / corner differences (mock → impl), regions shifted by more than 40px, colors that are not tokens. With `--pixel` also a pixel heatmap (0–99 per 200×200 cell), side-by-side crops (design | impl), size/weight/spacing differences and every shift.
   The full, uncapped list is in `.design-check/report-Sxx.md`; Read it once if the output says `+N more`.
   If a screen state is missing: add it to `design-shots.spec.ts` and its mock preset (from `docs/design/README.md`) to `states.json`.
   If the shots fail because port 1420 serves something else (a running `tauri dev`), say so in the result; don't stop other processes.
3. Judge from the text; numbers from the DOM comparison are exact, don't re-measure them. Structure mode: open a crop only when a region is missing or misplaced and the text can't tell why. Pixel mode: open crops for what text cannot show (layout, icons, borders vs fills, focus rings); a cell score near 0 needs no look. Make sure the mock backend fixtures (`src/ipc/mock/fixtures`) carry the mock's example data; real data differences (names, numbers) are not issues.
4. Table: region · difference · severity (must fix / should fix / acceptable because …). Check against `03-design-system.md`: tokens only, square corners, fills not borders, word tags, Barlow Condensed uppercase on headings/buttons/tags, exact English copy. In structure mode a size or spacing difference is never must/should fix; list at most a one-line "left for the polish pass" summary.
5. Fix all "must fix" and "should fix" items, then re-run step 2 with `--states` of the affected states only. Within the mode's fix rounds; whatever remains goes into the table with a reason or under "needs the user". Keep `.design-check/` out of git.
6. Do not commit; the main session does. Return only this, in English, no images:
   - the mode, and the table from step 4 (final state, every remaining difference with its justification);
   - what you fixed, as `file — change` lines;
   - checks you ran after the fixes (`node tools/verify.mjs --only typecheck,lint,test` at least) and their result;
   - anything that needs the user (spec unclear, a difference you could not fix).
