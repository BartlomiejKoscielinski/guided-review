Plan a guided review of merge request !{{iid}} "{{title}}" in {{project}} ({{source_branch}} → {{target_branch}}).

Inputs (read them with the Read tool):
- MR description: {{description_file}}
- Hunk index (one line per hunk: hunk_id, file, layer guess, +/-, first changed line): {{hunk_index_file}}
- Full diff: {{diff_file}}
- Existing discussion threads (summary): {{threads_file}}
- Team rules (trusted, from the target branch): {{rules_file}}
- Mechanical hunks the app already detected (put them in skim unless they hide logic): {{mechanical_file}}
The worktree at the MR head is your working directory; read surrounding code when a hunk needs context.

Produce:
1. intent: what the change does and why, for a reviewer, in 2–4 sentences.
2. steps: group hunks into 3–10 steps a reviewer can read in order. Each step is one idea (a contract, its implementation, its consumer, its UI, its wiring, its tests). Every hunk_id from the index appears in exactly one step or in skim. Use the given layer names. builds_on lists earlier steps the reader must know.
3. orders.contract_to_ui: step ids from what everything builds on (interfaces, models) to infrastructure, app logic, XAML/UI, wiring, platforms, tests last. orders.tests_first: tests first, then the same order.
4. skim: mechanical groups (formatting, generated code, resource keys, package bumps) with a short reason. Only if they truly contain no logic.
5. risks: up to 6 concrete things to check (races, lifecycle, data growth, error handling, security), each with step ids.
6. description_check: compare claims in the MR description with the code: found (with step), missing, contradicted; also notable behaviour in the code that the description doesn't mention (status not_in_description).
7. already_discussed: one or two sentences about existing threads, so the reviewer doesn't repeat them.
