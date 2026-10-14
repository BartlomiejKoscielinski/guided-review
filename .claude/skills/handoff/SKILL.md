---
name: handoff
description: End a Guided Review session - update docs/PROGRESS.md (ticks with SHAs, one session-log row), commit it, and write a short self-contained prompt for the next session. Use at the end of every session, when a phase ends with a commit, or when the user says /handoff.
argument-hint: [optional focus of the next session]
---

Next session focus (optional): $ARGUMENTS

**In a lane** (`.lanes/<lane>/lane.json` exists in this worktree, E4): do step 1, then instead of steps 2–4 write `.lanes/<lane>/report.md` (`.lanes/` is not committed): `## Done` (AC IDs with SHAs) · `## Tests` (names or counts; `/verify`, e2e, `/design-check` results) · `## Deviations` (from the spec or plan, with reasons) · `## Contract requests` (changes outside `--owns` or to IPC types, or `none`) · `## Open`. No PROGRESS, no metrics. Step 5 only when the lane is unfinished: the prompt continues it in this worktree (read `.lanes/<lane>/context.md` and the report). Otherwise tell the user the lane is ready for `/integrate <Mx>`.

1. State: `git status --short`, `git log --oneline -15`, current branch. If there are uncommitted changes that belong to this session's work, ask whether to commit them first.
2. PROGRESS, by section only (`grep -n '^## \|^- \[ \]' docs/PROGRESS.md`; never read the whole file):
   - tick criteria finished in this session with their SHAs, `(sha)` or `(sha, sha)`; mark partial ones `— partial: <what is missing>`;
   - append one session-log row: date · milestone and session · what was done with SHAs, deviations, open issues · `Tasks x/y` (numbered prompt tasks done / planned, and `guard at 120k before task n` if the warning came first; E5) · Next (who does what). Keep the row under ~150 words; details belong in commits and docs.
   - run `node tools/audit.mjs --milestone <Mx>` and fix any SHA gap you introduced.
3. Process metrics (one call): `node tools/metrics/report.mjs && node tools/metrics/report.mjs --retro-due`. Keep its numbers for the final message (turns, max context, cache read, top tax). If a retro is due, make `/retro` the first task of the next prompt (or run it now if the user agrees).
4. Commit: `<Mx>: PROGRESS session log <session>` with `.metrics/sessions.jsonl` (no Co-Authored-By trailer).
5. Write the next-session prompt in a fenced block, in the user's language and in plain words: full sentences, no shorthand, every internal name (an ID, a script, a role) with a few words of what it is. The owner reads it and must understand it. At most ~35 lines:
   - first line: branch, clean tree, last commit SHA;
   - then the main goal, first and in one or two sentences: what the session achieves and why it matters (one phase: plan, one core feature, one screen with its design-check, or wrap-up). If the remaining work is larger, split it and give only the first part;
   - budget: the prompt plus everything it tells the session to read must fit in ~100k tokens of context (base is ~43k, so ~55k of reading and work; the context guard warns at 200k), and has at most 3 numbered tasks;
   - what is already done that it must not redo, and what not to read;
   - exactly which files and sections to read (paths, `S-xx`/`F-xx` IDs, grep patterns), nothing more;
   - numbered tasks (max 3), each with three parts: what to do, why (what it serves), and when it is done (tests, `/verify`, `/design-check S-xx`);
   - the last step: `/handoff`.
6. Tell the user in plain language and full sentences, main point first: what works now, what is missing and what comes next. Then the session's numbers in one line, and that they should start a new session and paste the prompt. Do not continue working in this session.
