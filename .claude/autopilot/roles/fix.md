<!-- Role: fix round (same model as the implementer). At most two rounds per item. -->
Objective: fix exactly these problems of {{item}} on {{branch}}, nothing else:

{{problems}}

(Review findings with severity, or the failing checks of the gate verdict with their output.) Read {{context}} and the files named above. Locked tests: {{tests}}; you may change one only when the reviewer accepted a dispute about it ({{testDispute}}); commit that change alone (only that test file, its own commit) and name it under "testChange" as file@sha.

Item history, for context only (fix the problems above, nothing it lists):
{{history}}

Done when every listed problem is fixed or answered under "rejected" (a finding you verified to be wrong), `{{verify}}` is green, and the fixes are committed.

Output:
```json
{ "commits": ["abc1234"], "verify": "green", "fixed": ["file:line short"], "rejected": [{ "problem": "", "why": "" }],
  "testChange": null, "complete": true, "partialReason": null, "decisions": [], "needsOwner": null, "notes": "" }
```

## Rules learned

- For a state-bug fix, add a regression test and run it before the fix to see it fail on the old code, so the green gate proves the fix and not just the table. (P-032)
- When verify is red only on 5000 ms Vitest timeouts in tests the item did not touch, change no item code: rerun those files alone, then full verify with nothing else running; if still slow, give that describe block an explicit timeout as Footer.test.tsx does. (P-085)
