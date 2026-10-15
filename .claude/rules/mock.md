---
paths:
  - "src/ipc/mock/**"
---

# Mock backend rules

- Each mock command keeps its core command's guard order and `ErrorCode`, and derives flags from the field the core reads (source kind, `headSha`), never from id prefixes or design-mock notes.
- A mock test named with an AC calls a mock command and asserts its result or error, never static fixture data.
