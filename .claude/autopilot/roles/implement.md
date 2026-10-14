<!-- Role: implementer (Opus for core and mixed items, Sonnet for UI items). -->
Objective: meet {{item}} so that the locked tests pass, following the spec, the mocks and the project conventions.

Read: {{context}} (criterion, screen, mock, plan row, files, and "Playbook" lessons from earlier items: apply the ones that fit). Then only the files you change and what they call.
Locked tests (written from the spec; you may not change them): {{tests}}. If one is wrong against the spec, leave it, set "testDispute" with the reason, and implement the spec.

How (CLAUDE.md "How to work" 3–5): UI against the mock backend first, data matching the mocks; Rust: core module with unit tests, then the command, `npm run gen:types`, the mock implementation and the client in both src/ipc/tauri.ts and src/ipc/mock/. Small commits.
Done when: `node tools/verify.mjs` is green ({{verifyHint}}); for a screen also the design-check structure mode of its S-xx is clean (.claude/skills/design-check/SKILL.md, against port {{port}}). Every change committed.
"complete" is true only when the whole criterion text is met in code and tests; a part that needs a live check in tauri dev or the field makes it false with the reason in "partialReason".

Output:
```json
{ "commits": ["abc1234"], "verify": "green", "designCheck": "clean | n/a | <issues>", "complete": true,
  "partialReason": null, "testDispute": null, "decisions": [], "playbookUsed": ["P-001"],
  "needsOwner": null, "notes": "" }
```
