<!-- Role: implementer (Opus for core and mixed items, Sonnet for UI items). -->
Objective: meet {{item}} so that the locked tests pass, following the spec, the mocks and the project conventions.
Scope: {{scope}}

Read: {{context}} (criterion, screen, mock, plan row, files, and "Playbook" lessons from earlier items: apply the ones that fit). Then only the files you change and what they call.

Item history (the backlog note and earlier attempts; their verdicts are in the folders named). On a repeat attempt start from what it says failed or is left; the code of earlier attempts may already be on {{base}}:
{{history}}

Locked tests (written from the spec; you may not change them): {{tests}}. If one is wrong against the spec, leave it, set "testDispute" with the reason, and implement the spec.

How (CLAUDE.md "How to work" 3–5): UI against the mock backend first, data matching the mocks; Rust: core module with unit tests, then the command, `npm run gen:types`, the mock implementation and the client in both src/ipc/tauri.ts and src/ipc/mock/. Small commits.
Done when: `{{verify}}` is green (run it exactly so); for a screen also the design-check structure mode of its S-xx is clean (.claude/skills/design-check/SKILL.md, against port {{port}}). Every change committed.
Before the output (E26), split into clauses every sentence of the criterion, every decision the context or the plan row cites (D-xx, "decision 8"), every clause of the plan row and of an owner request in the history, and give each in "clauses" the file:line that meets it and the test that shows it; build any clause left without both before you hand in.
"complete" is true only when the whole criterion text is met in code and tests; a part that needs a live check in tauri dev or the field makes it false with the reason in "partialReason".

Output:
```json
{ "commits": ["abc1234"], "verify": "green", "designCheck": "clean | n/a | <issues>", "complete": true,
  "partialReason": null, "testDispute": null, "decisions": [], "playbookUsed": ["P-001"],
  "clauses": [{ "clause": "", "where": "src/…:12", "test": "" }],
  "needsOwner": null, "notes": "" }
```

## Rules learned

- Any user-visible copy that the spec and mock do not give needs a test assertion in the same commit, not only a decision note. (P-017)
- When a new state changes what a design shot shows, seed that state in tests/e2e/design-shots.spec.ts in the same implement commit, so the design-check compares the screen in that state. (P-023)
- A command that only reads stored state or caches (restore, resume, status) must not call the Claude binary lookup (executable()) or any other discovery, so it works without Claude Code installed. (P-008)
- When a core flag reaches a screen (Hunk.mechanical feeding the Skim row), set it in the mock backend in the same item, after listing the existing tests that read the unflagged rows, so dev:mock and e2e show the state and those tests stay green. (P-012)
