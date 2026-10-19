---
paths:
  - "src-tauri/tests/**"
  - "src-tauri/src/**/*_tests.rs"
  - "src/**/*.test.{ts,tsx}"
  - "tests/e2e/**"
---

# Test rules

- Before committing an assertion, name the production change that would make it fail. Seed through the production write path and read through the production read path; an error branch gets an injected error, not an empty result.
- For a state change (dismiss, undo, reorder, restore), assert what the screen or a reload shows in each state, not only the stored row.
- Screen and e2e tests assert the content the criterion names (a button, the plan rows); the landmark name and the route also pass on an empty stub.
