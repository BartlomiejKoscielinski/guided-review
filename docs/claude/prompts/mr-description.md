Write the merge request title and description for branch {{source_branch}} → {{target_branch}}.
Commits (subjects and bodies): {{commits_file}}
Diff: {{diff_file}}
Self-review notes the author kept (may be empty): {{notes_file}}
Variant: {{variant}}  (short = 1–2 sentences per section; long = up to 5)

title: at most 72 characters.
what: what changes for users and in the code.
why: the reason; if unknown from the inputs, say what problem it appears to solve without inventing ticket numbers.
how_to_test: concrete numbered steps a tester can follow on a device or emulator, including edge cases visible in the diff.
