---
name: audit
description: Check traceability between acceptance criteria in docs/01-product.md, docs/PROGRESS.md and tests, and fix the gaps. Use at the end of a milestone or when the user says /audit.
argument-hint: [optional milestone, e.g. M3]
---

1. If a milestone was given ("$ARGUMENTS"), run `node tools/audit.mjs --milestone $ARGUMENTS`; with no argument run `node tools/audit.mjs` for everything.
2. For each reported problem:
   - "ticked without test or manual check": write the missing test (name it with the ID) or, if it truly can only be checked by hand, add it to the manual checklist in `docs/09-testing.md`.
   - "ticked without commit SHA": add the SHA of the commit that completed it (`git log --oneline --grep <ID>`).
   - "has tests but not ticked": verify the feature is complete; tick it with its SHA or note what is missing.
   - "missing in PROGRESS" / orphan IDs: the spec and PROGRESS drifted; fix PROGRESS to match `01-product.md` (never the other way round without asking).
3. Re-run until it reports no gaps for the audited scope, then summarise.
