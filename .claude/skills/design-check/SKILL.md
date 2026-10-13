---
name: design-check
description: Compare an implemented screen of Guided Review with its design mock and screenshots, list every difference and fix or justify it. Use after building or changing UI, or when the user says /design-check S-xx.
argument-hint: [screen id, e.g. S-05]
# Runs in its own subagent so screenshots, crops and mock text never enter the main session.
# Not in the background: it edits files, and the caller needs the result before committing.
# Sonnet: comparing crops and fixing CSS does not need Opus; every turn re-reads ~60k of context.
context: fork
background: false
model: sonnet
effort: medium
---

Screen: $ARGUMENTS

Budget: **at most ~20 tool calls and 2 fix rounds.** Every call costs a full turn of context, so chain shell commands in one call and never explore the mock or the report with many small `sed`/`grep` calls. Never Read a whole `*.dc.html` mock or a full 1600×1000 PNG; read docs by section only.

1. Context (one call): the `S-xx` section of `docs/02-screens.md` (`grep -n '^## '`, then Read with offset/limit). Look up `03-design-system.md` only for a token or rule in question.
2. Gather everything with one command (it starts the mock dev server through Playwright if needed):
   `node tools/mock-preview/design-check.mjs Sxx` (`--states a,b` to limit, `--no-shots` to reuse captures).
   For every state in `tests/e2e/design-shots.spec.ts` it captures the implementation, renders the mock state from `tools/mock-preview/states.json`, and prints:
   - a pixel heatmap (0–99 per 200×200 cell) and side-by-side crops (design | impl) of the most different cells;
   - **DOM comparison** by text: copy differences, typography/color/box differences with token names (mock → impl), groups of shifted elements (dx,dy), colors that are not tokens. Code tokens are compared for font only.
   The full, uncapped list is in `.design-check/report-Sxx.md`; Read it once if the output says `+N more`.
   If a screen state is missing: add it to `design-shots.spec.ts` and its mock preset (from `docs/design/README.md`) to `states.json`.
3. Judge from the text first; numbers from the DOM comparison are exact, don't re-measure them. Open only crops for what text cannot show (layout, icons, borders vs fills, focus rings); a cell score near 0 needs no look. Make sure the mock backend fixtures (`src/ipc/mock/fixtures`) carry the mock's example data; real data differences (names, numbers) are not issues.
4. Table: region · difference · severity (must fix / should fix / acceptable because …). Check against `03-design-system.md`: tokens only, square corners, fills not borders, word tags, Barlow Condensed uppercase on headings/buttons/tags, exact English copy.
5. Fix all "must fix" and "should fix" items, then re-run step 2 with `--states` of the affected states only. At most 2 fix rounds; whatever remains goes into the table with a reason or under "needs the user". Keep `.design-check/` out of git.
6. Do not commit; the main session does. Return only this, in English, no images:
   - the table from step 4 (final state, every remaining difference with its justification);
   - what you fixed, as `file — change` lines;
   - checks you ran after the fixes (`node tools/verify.mjs --only typecheck,lint,test` at least) and their result;
   - anything that needs the user (spec unclear, a difference you could not fix).
