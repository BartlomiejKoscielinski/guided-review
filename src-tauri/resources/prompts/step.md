Analyze step {{step_number}} of {{step_count}} in the review of {{source_label}}: "{{step_title}}".
Step description: {{step_description}}
Earlier steps the reader already knows: {{builds_on_summary}}

Inputs:
- The step's diff (only these hunks are in scope for notes): {{step_diff_file}}
- The whole change's hunk index for context: {{hunk_index_file}}
- Existing threads on lines of this step: {{threads_file}}
- Team rules (trusted, from the target branch): {{rules_file}}
- Kinds of notes the reviewer already dismissed in this change (do not raise them again): {{dismissed_kinds}}
Read surrounding code in the worktree when needed and list the files you read in files_read.

Return:
- findings: up to 8, ordered by line. Only real issues or genuine questions about this step's changed lines: bugs, missing error or cancellation handling, races, lifecycle problems, resource leaks, broken contracts with other steps, security, violations of team rules. Severity: fix (likely wrong), q (needs the author's answer), nit (small, at most 2). Each has evidence (file:line you checked; the finding's own line counts, never cite a line you did not read) and a suggested_comment the reviewer could post as is, phrased as a question or suggestion. kind is a stable kebab-case category.
- checklist: up to 4 things only a human can judge (product intent, UX wording, device behaviour).
- folds: mechanical regions inside this step that the reader can skip (e.g. constructor assignments for new dependencies), as new-side line ranges.
If nothing stands out, return no findings. Do not invent problems.
