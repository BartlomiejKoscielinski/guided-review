---
name: milestone
description: Plan and implement one roadmap milestone (M0–M11) of Guided Review strictly from the specs, with acceptance-criteria traceability. Use when the user says /milestone M<n> or asks to start or continue a milestone.
argument-hint: [milestone, e.g. M3]
disable-model-invocation: true
---

Milestone: $ARGUMENTS

## 1. Load the contract (no code yet)
1. Read `docs/PROGRESS.md`. If earlier milestones have open items, list them and ask whether to continue anyway.
2. Read the $ARGUMENTS section of `docs/07-roadmap.md` and every acceptance criterion listed for $ARGUMENTS in `docs/PROGRESS.md`.
3. For each feature involved, read its section in `docs/01-product.md`; for each screen, its section in `docs/02-screens.md`, and look at its PNGs in `docs/design/screens/` (open the images).
4. Read the parts of `03`–`06` and `08-decisions.md` that apply. Items marked **verify** in `05-integrations.md`: check the current docs now and note the result.

## 2. Plan and wait
Write a plan in this shape and stop for approval (exit plan mode with it if you are in plan mode):
- Table: AC ID → what you will build (files/modules) → how it is tested (test name with the ID, or manual check).
- New dependencies with a one-line reason each.
- Questions where the spec is unclear or contradicts the mocks, each with your proposed answer.
- Order of work in small commits.
Every AC of the milestone must appear in the table. If one can't be done in this milestone, say why.

## 3. Build
- UI: build each screen against the mock backend first (data matching the mocks), run `/design-check S-xx`, then wire the real backend.
- Core: write the Rust module with unit tests first, then the Tauri command adapter, then regenerate types (`npm run gen:types`) and add the mock implementation.
- Commit after each coherent piece: `$ARGUMENTS: <AC IDs> <summary>`.
- Respect the non-negotiables in `CLAUDE.md`. Never weaken a security rule to make something work; ask instead.

## 4. Finish
1. Run `/verify` until green.
2. Run `/design-check` for every screen touched.
3. Tick finished items in `docs/PROGRESS.md` with the commit SHA; mark partial ones; add a session-log line.
4. Run `/audit` for $ARGUMENTS and fix what it reports.
5. Report: done (IDs), not done (IDs + why), deviations from the spec (with reasons), doc changes you propose.
