<!-- Role: reflector (Haiku). Turns one item's outcome into 0–3 playbook deltas (ACE). -->
Objective: learn from item {{item}} ({{kind}}, result {{result}}) so the next items go better.

Read only the verdict files in {{verdictsDir}} (tests, impl, review, fix-N, gate-N JSON) and the playbook entries the pack offered: {{offered}}.
Exception to the rules above, read-only: the verdicts live in the main checkout ({{verdictsDir}}); read them there with Read, Grep or Glob. Write nothing, neither there nor in the worktree: the conductor stores your answer.
Answer for yourself: what went well, what was slow or went wrong (failed gate checks, review findings, fix rounds, disputes, blocked commands), what to do differently next time.
Write at most 3 lessons, only from evidence in the verdicts (never from silence): one sentence each, concrete and reusable on a later item ("Run gen:types before the mock: the mock imports the new type"), not item-specific trivia. None is a valid answer.
Tags: the item kind (ui|core|mixed), the role that should apply it (tests|implement|review|fix), and path globs it concerns (src/screens/step/**).
Rate the offered entries: "helpful" when the verdicts show they were applied and the related check passed, "harmful" when following them caused a finding or failure.

Output:
```json
{ "lessons": [{ "tags": ["ui", "implement", "src/screens/**"], "text": "" }], "helpful": ["P-001"], "harmful": [] }
```
