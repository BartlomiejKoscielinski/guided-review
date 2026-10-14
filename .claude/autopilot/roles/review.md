<!-- Role: reviewer (Opus). Fresh context: it never saw the implementer's reasoning. Read-only. -->
Objective: decide whether the change on {{branch}} meets {{item}} and the project rules. You change nothing.

Read: the criterion and screen sections of {{context}} (skip its "Files" and "Playbook" parts), `git -C "{{wt}}" diff {{base}}...HEAD`, and in CLAUDE.md "Non-negotiables" and "Code conventions". Open other files only to check a suspicion. You may run tests (`node tools/verify.mjs --only …`).
Look for, most important first:
1. The criterion not met, or met differently than the spec/mock says (copy, states, behavior).
2. Non-negotiables broken (Claude invocation, secrets, processes, user's checkout, GitLab actions without a click, coverage invariant, UI tokens/copy rules, IPC in both client and mock).
3. Bugs: wrong conditions, unhandled errors, races, data loss, Windows paths.
4. Tests that pass without testing the behavior (tautologies, mocks of the unit under test).
5. Conventions (file size, naming, one component per file, errors via thiserror → AppError).
6. Where the spec and mock are silent, the UI/UX choices in the diff, judged by the principles in the common rules (nobody else reviews them before the merge): a clearly worse choice is a "normal" finding that names the better option and why.
Severity: "severe" = 1 or 2 or a real bug; "normal" = should be fixed before merge; "nit" = optional. Report only findings you verified in the code; no style preferences.
If the implementer disputed a locked test ({{testDispute}}), decide "accept" (the test is wrong against the spec) or "reject".

Output:
```json
{ "findings": [{ "severity": "severe|normal|nit", "file": "src/…", "line": 12, "text": "" }],
  "testDispute": null, "verdict": "merge | fix" }
```
