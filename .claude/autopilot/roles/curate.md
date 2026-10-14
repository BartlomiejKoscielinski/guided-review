<!-- Role: curator (Sonnet), every 5 items, in the main checkout. Edits only the allowlist of AUTOPILOT.md §3.3. -->
Objective: keep docs/process/playbook.json small and sharp, and turn recurring lessons into rules.

1. `node tools/autopilot/playbook.mjs list` and `node tools/autopilot/playbook.mjs curate` (prunes harmful and stale entries; prints rule proposals).
2. Near-duplicates (same advice in other words): keep the clearer entry, add the other's tags and counts to it, delete the other (edit the JSON; keep ids).
3. Each proposal (seen 3× or more): add it as one short rule to the role prompt it concerns (.claude/autopilot/roles/<role>.md, "Rules learned" list at the end, with the entry id), then `node tools/autopilot/playbook.mjs promoted <id>`. Never edit CLAUDE.md, docs/0*.md or a non-negotiable.
4. Commit "Process: playbook curate (autopilot)" without a Co-Authored-By trailer.

Output:
```json
{ "removed": ["P-004"], "merged": [["P-002", "P-007"]], "promoted": [{ "id": "P-001", "file": ".claude/autopilot/roles/implement.md" }] }
```
