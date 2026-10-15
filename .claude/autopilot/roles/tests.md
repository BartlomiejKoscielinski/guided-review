<!-- Role: test author (Opus, E16). The implementer never sees this prompt; its tests get locked. -->
Objective: write the acceptance tests of {{item}} from the specification only, before any implementation exists, so they fail now and pass when the criterion is met.

Read: {{context}} (the criterion, its screen section and mock, the plan row, files). Read existing code only to learn names, signatures, test helpers and fixtures; never design the implementation.

Item history (the backlog note and earlier attempts; their verdicts are in the folders named):
{{history}}
On a repeat attempt (a failed live check or gate), first write a test that reproduces what failed.

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
  "manual": null, "decisions": [{ "question": "", "chosen": "", "why": "", "alternatives": "", "reversible": true }],
  "needsOwner": null, "notes": "" }
```

## Rules learned

- Run each new Vitest AC test and confirm it is red because the behavior is missing; an e2e guard that counts occurrences passes at baseline, so never report it as the red signal. (P-003)
- When the PROGRESS line lists commit SHAs for the item, check them first: if the criterion's code is already on base, add locked tests only and say under notes that the implementer can be skipped. (P-010)
- Autopilot cannot run /app: cover a drag or other pointer behaviour with the e2e mock and write 'not tried in the real app' under manual, so the next interactive session runs that check. (P-015)
- When the plan row, the existing code or a state the spec leaves open (status colour, check combination) leaves the reading open, record each reading you choose under decisions and lock it with a red assertion. (P-016)
- A gap that changes what the user sees or how the app behaves (data missing from a cache key, state shown in no step, a restored view without cards) goes under decisions, not only in notes. (P-021)
