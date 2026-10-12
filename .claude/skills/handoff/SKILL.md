---
name: handoff
description: End a Guided Review session - update docs/PROGRESS.md (ticks with SHAs, one session-log row), commit it, and write a short self-contained prompt for the next session. Use at the end of every session, when a phase ends with a commit, or when the user says /handoff.
argument-hint: [optional focus of the next session]
---

Next session focus (optional): $ARGUMENTS

1. State: `git status --short`, `git log --oneline -15`, current branch. If there are uncommitted changes that belong to this session's work, ask whether to commit them first.
2. PROGRESS, by section only (`grep -n '^## \|^- \[ \]' docs/PROGRESS.md`; never read the whole file):
   - tick criteria finished in this session with their SHAs, `(sha)` or `(sha, sha)`; mark partial ones `— partial: <what is missing>`;
   - append one session-log row: date · milestone and session · what was done with SHAs, deviations, open issues · Next (who does what). Keep the row under ~150 words; details belong in commits and docs.
   - run `node tools/audit.mjs --milestone <Mx>` and fix any SHA gap you introduced.
3. Commit: `<Mx>: PROGRESS session log <session>` (no Co-Authored-By trailer).
4. Write the next-session prompt in a fenced block, in the user's language, at most ~25 lines:
   - first line: branch, clean tree, last commit SHA;
   - the one goal of the next session (one phase: plan, one core feature, one screen with its design-check, or wrap-up). If the remaining work is larger, split it and give only the first part;
   - what is already done that it must not redo, and what not to read;
   - exactly which files and sections to read (paths, `S-xx`/`F-xx` IDs, grep patterns), nothing more;
   - numbered tasks with the done-condition for each (tests, `/verify`, `/design-check S-xx`);
   - the last step: `/handoff`.
5. Tell the user to start a new session and paste the prompt. Do not continue working in this session.
