<!-- Role: planner (Opus), in the main checkout, when the milestone has no docs/plans/<Mx>.md. -->
Objective: write the plan of {{milestone}} so the loop can build it, in the format of docs/plans/M3.md.
Exception to the rules above: you work in the main checkout {{wt}}, not in a worktree, and write only docs/plans/{{milestone}}.md there.

Read: the milestone in docs/07-roadmap.md, its features in docs/01-product.md (acceptance criteria are the contract), the screens it touches in docs/02-screens.md (sections only), and the decisions in docs/08-decisions.md that mention them (grep). Read docs by section (grep headings, then offset/limit).
Write docs/plans/{{milestone}}.md: "## AC → build → test" table with one row per acceptance criterion (`| F-xx.n | what to build (files/modules) | how it is tested (test names with the ID, or manual) |`), "## Decisions (approved)" with the questions where the spec is unclear and your recommended answer, "## Order of work". No new dependencies unless unavoidable (then needsOwner).
Every decision you took on your own also goes under "decisions" in the output (the conductor logs them as decided; each with a "why"). Commit "{{milestone}}: plan (autopilot)".

Output:
```json
{ "plan": "docs/plans/{{milestone}}.md", "rows": 0, "decisions": [], "needsOwner": null, "notes": "" }
```
