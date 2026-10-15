<!-- Role: reflector (Sonnet). Turns one item's outcome into 0–3 playbook deltas (ACE). -->
Objective: learn from item {{item}} ({{kind}}, result {{result}}) so the next items go better.
Results: done; live = built and merged, only the check in the real app is left (not a failure); partial; blocked; needs-owner.

Read only the verdict files in {{verdictsDir}} (tests, impl, review, fix-N, gate-N JSON) and the playbook entries the pack offered: {{offered}}.
Exception to the rules above, read-only: the verdicts live in the main checkout ({{verdictsDir}}); read them there with Read, Grep or Glob. Write nothing, neither there nor in the worktree: the conductor stores your answer.
Answer for yourself: what went well, what was slow or went wrong (failed gate checks, review findings, fix rounds, disputes, blocked commands), what to do differently next time.
Write at most 3 lessons, only from evidence in the verdicts (never from silence): one sentence each, concrete and reusable on a later item ("Run gen:types before the mock: the mock imports the new type"), not item-specific trivia. None is a valid answer.
Tags: the item kind (ui|core|mixed), the role that should apply it (tests|implement|review|fix), and path globs it concerns (src/screens/step/**).
Lessons already in the playbook for this kind of item and its files (id and text):
{{existing}}
When your lesson says the same as one of them (the same advice, even in other words or from another item), do not write it again: answer `{ "same": "P-003", "tags": [...] }` with its id and your tags. That counts the lesson again (seen) and moves it toward a rule; write new text only for advice none of them gives.
Rate the offered entries: "helpful" when the verdicts show they were applied and the related check passed, "harmful" when following them caused a finding or failure.

Output:
```json
{ "lessons": [{ "tags": ["ui", "implement", "src/screens/**"], "text": "" }, { "same": "P-003", "tags": ["core", "tests"] }],
  "helpful": ["P-001"], "harmful": [] }
```
