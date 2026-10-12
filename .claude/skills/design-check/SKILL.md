---
name: design-check
description: Compare an implemented screen of Guided Review with its design mock and screenshots, list every difference and fix or justify it. Use after building or changing UI, or when the user says /design-check S-xx.
argument-hint: [screen id, e.g. S-05]
# Runs in its own subagent so screenshots, crops and mock text never enter the main session.
# Not in the background: it edits files, and the caller needs the result before committing.
context: fork
background: false
---

Screen: $ARGUMENTS

Token budget: images and the mocks (40–50 KB each) are the expensive part. Never Read a whole `*.dc.html` mock, never open a full 1600×1000 PNG, and read docs by section only.

1. Context, by section only: `grep -n '^## ' docs/02-screens.md`, then Read just the `S-xx` section (offset/limit). From `docs/design/README.md` take only the screen's row (`grep -n 'S-xx' docs/design/README.md`): mock file and state presets. Look up `03-design-system.md` only for the token or rule in question (grep).
2. Mock data: make sure the mock backend (`src/ipc/mock/fixtures`) has the same example data as the mock. Get the mock's strings with `node tools/mock-preview/render-mock.mjs <Mock.dc.html> --state '<json>' --text --out .design-check/mock-<screen>-<state>.png` (writes the rendered text to the matching `.txt`; grep it) or grep the mock for a specific value, not by reading the mock file.
3. Capture the implementation: start `npm run dev:mock` if it isn't running, then run only this screen's shots: `npx playwright test design-shots --reporter=line -g "Sxx"` (shot titles use `S06`, no dash) (`tests/e2e/design-shots.spec.ts`; add the screen's states if missing). It saves `.design-check/impl-<screen>-<state>.png` at 1600×1000.
4. Design image: `docs/design/screens/<Sxx>-<state>.png`. If a state has no PNG, render it: `node tools/mock-preview/render-mock.mjs <Mock.dc.html> --state '<json>' --out .design-check/mock-<screen>-<state>.png`.
5. Diff before looking: `node tools/mock-preview/diff-shots.mjs <design.png> <impl.png> --out-prefix .design-check/cmp-<screen>-<state>`. It prints a heatmap (0–99 per 200×200 cell) and writes side-by-side crops (design | impl) of the 4 most different cells. Open only those crops; for a specific area use `--region x,y,w,h` (repeatable), `--grid 16x10` for finer cells. Cells near 0 need no look. Large uniform scores across a row usually mean a vertical offset: find it once rather than reporting every cell.
6. For each opened crop compare:
   - layout and proportions of regions, alignment, gaps;
   - typography: font family, size, weight, uppercase on condensed elements, line height;
   - colors: only tokens; meaning of colors as in `03-design-system.md`;
   - copy: exact English strings (compare text from `--text` with the implementation's DOM, not pixels);
   - components: square corners, fills not borders, word tags;
   - states: focus rings, selected items, disabled controls.
   For exact values (font size, color, gap), read computed styles in the dev-mock page with a short script rather than estimating from pixels.
7. Output a table: region · difference · severity (must fix / should fix / acceptable because …). Real data differences (names, numbers) are not issues.
8. Fix all "must fix" and "should fix" items, re-capture only the affected states, re-run the diff and open only crops whose score did not drop. Repeat until only justified differences remain. Keep `.design-check/` out of git.
9. Do not commit; the main session does. Return only this, in English, no images:
   - the table from step 7 (final state, every remaining difference with its justification);
   - what you fixed, as `file — change` lines;
   - checks you ran after the fixes (`node tools/verify.mjs --only typecheck,lint,test` at least) and their result;
   - anything that needs the user (spec unclear, a difference you could not fix).
