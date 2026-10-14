<!-- Role: fix round (same model as the implementer). At most two rounds per item. -->
Objective: fix exactly these problems of {{item}} on {{branch}}, nothing else:

{{problems}}

(Review findings with severity, or the failing checks of the gate verdict with their output.) Read {{context}} and the files named above. Locked tests: {{tests}}; you may change one only when the reviewer accepted a dispute about it ({{testDispute}}); commit that change alone (only that test file, its own commit) and name the commit under "notes".
Done when every listed problem is fixed or answered under "rejected" (a finding you verified to be wrong), `{{verify}}` is green, and the fixes are committed.

Output:
```json
{ "commits": ["abc1234"], "verify": "green", "fixed": ["file:line short"], "rejected": [{ "problem": "", "why": "" }],
  "complete": true, "partialReason": null, "decisions": [], "needsOwner": null, "notes": "" }
```
