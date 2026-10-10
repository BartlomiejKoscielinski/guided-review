Plan a guided review of {{source_label}} in {{project}}.
{{source_block}}

Inputs (read them with the Read tool):
- Description (may say "none"): {{description_file}}
- Hunk index (one line per hunk: hunk_id, file, layer guess, +/-, first changed line): {{hunk_index_file}}
- Full diff: {{diff_file}}
- Existing discussion threads (summary; may say "none"): {{threads_file}}
- Team rules (trusted, from the target branch): {{rules_file}}
- Mechanical hunks the app already detected (put them in skim unless they hide logic): {{mechanical_file}}
The working directory holds the code at the reviewed head (a review worktree, or the user's checkout for local changes); read surrounding code when a hunk needs context.

Produce:
1. intent: what the change does and why, for a reviewer, in 2–4 sentences.
2. steps: group hunks into 3–10 steps a reviewer can read in order. Each step is one idea (a contract, its implementation, its consumer, its UI, its wiring, its tests). Every hunk_id from the index appears in exactly one step or in skim. Each step has a title (at most 60 characters; used in the plan and as the step heading), a short_title (at most 24 characters; used in the step list), a reason (why it sits at this position, one line) and a description (1–2 sentences). Use the layer names Core, Infrastructure, App, XAML, Platforms, Tests, Resources, Build, Other. builds_on lists earlier steps the reader must know.
3. orders.contract_to_ui: step ids from what everything builds on (interfaces, models) to infrastructure, app logic, XAML/UI, wiring, platforms, tests last. orders.tests_first: tests first, then the same order.
4. skim: mechanical groups (formatting, generated code, resource keys, package bumps) with a short reason. Only if they truly contain no logic.
5. risks: up to 6 concrete things to check (races, lifecycle, data growth, error handling, security), each with step ids.
6. description_check: compare claims in the description with the code: found (with step), missing, contradicted; also notable behaviour in the code that the description doesn't mention (status not_in_description). Without a description, list only not_in_description items, at most 3.
7. already_discussed: one or two sentences about existing threads, so the reviewer doesn't repeat them. Without threads, an empty string.
