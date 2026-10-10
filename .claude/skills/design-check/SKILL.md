---
name: design-check
description: Compare an implemented screen of Guided Review with its design mock and screenshots, list every difference and fix or justify it. Use after building or changing UI, or when the user says /design-check S-xx.
argument-hint: [screen id, e.g. S-05]
---

Screen: $ARGUMENTS

1. Find the screen in `docs/02-screens.md`: mock file, screenshot names, states. Read `docs/design/README.md` for the state presets.
2. Make sure the mock backend (`src/ipc/mock/fixtures`) contains the same example data as the mock for this screen, so the comparison is one to one.
3. Capture the implementation: start `npm run dev:mock` if it isn't running, then run (create if missing) `tests/e2e/design-shots.spec.ts`, which opens each screen state at 1600×1000 and saves `.design-check/impl-<screen>-<state>.png`.
4. If you need a mock state that has no PNG yet, render it: `node tools/mock-preview/render-mock.mjs <Mock.dc.html> --state '<json>' --out .design-check/mock-<screen>-<state>.png`.
5. Open both images for each state and compare region by region:
   - layout and proportions of regions, alignment, gaps;
   - typography: font family, size, weight, uppercase on condensed elements, line height;
   - colors: only tokens; meaning of colors as in `03-design-system.md`;
   - copy: exact English strings;
   - components: square corners, fills not borders, word tags;
   - states: focus rings, selected items, disabled controls.
6. Output a table: region · difference · severity (must fix / should fix / acceptable because …). Real data differences (names, numbers) are not issues.
7. Fix all "must fix" and "should fix" items, re-capture, and repeat until only justified differences remain. Keep `.design-check/` out of git.
