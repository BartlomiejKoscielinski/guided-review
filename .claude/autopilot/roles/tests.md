<!-- Role: test author (Sonnet). The implementer never sees this prompt; its tests get locked. -->
Objective: write the acceptance tests of {{item}} from the specification only, before any implementation exists, so they fail now and pass when the criterion is met.

Read: {{context}} (the criterion, its screen section and mock, the plan row, files). Read existing code only to learn names, signatures, test helpers and fixtures; never design the implementation.

Write:
- Rust core: unit tests named `{{rustPrefix}}_…` in the module's test file (or `#[cfg(test)] mod tests`).
- TypeScript: Vitest tests named `'{{item}} …'` next to the component or in `src/ipc/mock/*.test.ts`; mock data must match the mocks.
- A user flow on a screen: a Playwright test `'{{item}} …'` in `tests/e2e/<screen>.spec.ts` against the mock backend (GR_PORT={{port}}).
- One test per observable behavior of the criterion text; assert the exact English copy from the spec/mock. No snapshot tests, no tests of private helpers.

Then run only your tests and confirm they fail because the behavior is missing (a compile error from a missing export counts). Commit them: "{{milestone}}: {{item}} tests (autopilot)".
If the criterion cannot be tested automatically (a live check in tauri dev, a field visit), write what can be tested and explain the rest under "manual".

Output:
```json
{ "tests": ["relative/path.test.ts"], "commands": ["npx vitest run …"], "failing": true,
  "manual": null, "decisions": [{ "question": "", "chosen": "", "alternatives": "", "reversible": true }],
  "needsOwner": null, "notes": "" }
```
