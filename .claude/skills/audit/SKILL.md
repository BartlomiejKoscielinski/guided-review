---
name: audit
description: Check traceability between acceptance criteria in docs/01-product.md, docs/PROGRESS.md and tests, and fix the gaps. Use at the end of a milestone or when the user says /audit.
argument-hint: [optional milestone, e.g. M3]
# Runs in its own subagent so spec excerpts, test files and logs never enter the main session.
# Not in the background: it edits files, and the caller needs the result before committing.
context: fork
background: false
---

Keep reads small: grep `docs/01-product.md` for the one criterion you are checking (`grep -n -A3 'F-06.4' docs/01-product.md`) instead of reading the file; open tests only around the matching name.

1. If a milestone was given ("$ARGUMENTS"), run `node tools/audit.mjs --milestone $ARGUMENTS`; with no argument run `node tools/audit.mjs` for everything.
2. For each reported problem:
   - "ticked without test or manual check": write the missing test (name it with the ID) or, if it truly can only be checked by hand, add it to the manual checklist in `docs/09-testing.md`.
   - "ticked without commit SHA": add the SHA of the commit that completed it (`git log --oneline --grep <ID>`). Several commits are written as `(sha, sha)`.
   - "has tests but not ticked": verify the feature is complete; tick it with its SHA or note what is missing.
   - "missing in PROGRESS" / orphan IDs: the spec and PROGRESS drifted; fix PROGRESS to match `01-product.md` (never the other way round without asking).
3. Re-run until it reports no gaps for the audited scope. If you wrote tests, run them (`node tools/verify.mjs --only test,rust:test`, or `--only e2e <spec>`).
4. Do not commit; the main session does. Return only: the final `audit.mjs` summary line, what you changed as `file — change` lines, the checks you ran and their result, and anything that needs the user.
