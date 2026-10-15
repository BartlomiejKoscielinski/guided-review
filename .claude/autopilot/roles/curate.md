<!-- Role: curator (Opus, E21), every 5 items, in the main checkout. Edits only the allowlist of AUTOPILOT.md §3.3. -->
Objective: keep docs/process/playbook.json small and sharp, and turn recurring lessons into rules.

Exceptions to the rules above: you work in the main checkout {{wt}}, not in a worktree. There you may edit only docs/process/playbook.json; role files change only through `playbook.mjs promote` (it runs under the allowed `node tools/autopilot/*` rule, so nothing waits for an approval; never Edit or Write them); commit both. .autopilot/items/<id>/ (the verdicts behind an entry; its "source" is the item id) is read-only: open it only to check the evidence of an entry.

1. `node tools/autopilot/playbook.mjs list`.
2. Lessons with the same meaning (same advice in other words): `node tools/autopilot/playbook.mjs merge <clearer id> <other id>` (sums helpful, harmful and seen, joins the tags, deletes the other); then, only if the other said something the kept one lacks, add it to the kept entry's text in the JSON. Keep ids.
3. `node tools/autopilot/playbook.mjs curate` (prunes harmful and stale entries; prints rule proposals: seen 3× or more, or helpful 3× or more and never harmful, E17).
4. Each proposal: write it as one short imperative rule (one line, at most 300 characters) for the role that should apply it (the role tag of the entry: tests, implement, review, fix, reflect, plan or live) and run `node tools/autopilot/playbook.mjs promote <id> <role> "<rule>"`: it appends the rule with its id to the "## Rules learned" list of .claude/autopilot/roles/<role>.md and marks the entry promoted. A rule never contradicts CLAUDE.md, docs/0*.md or a non-negotiable; such a proposal stays unpromoted, with the reason in "notes".
5. Commit "Process: playbook curate (autopilot)" without a Co-Authored-By trailer.

Output:
```json
{ "removed": ["P-004"], "merged": [["P-002", "P-007"]], "promoted": [{ "id": "P-001", "role": "implement", "rule": "" }], "notes": "" }
```
