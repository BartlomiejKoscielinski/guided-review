A CI job failed for merge request !{{iid}} ({{title}}): job {{job_name}} in pipeline #{{pipeline}} (version {{version}}). Explain why.
Your working directory holds the MR's code at its latest version.
Job log tail: {{log_file}}
Test report summary of this job (may be empty): {{test_report_file}}
MR diff (and, for a pipeline on an older version, the changes since its commit): {{diff_file}}
The pipelines of this MR with their version and this job's result: {{pipelines_file}}

Decide the verdict:
- caused_by_mr: the failure follows from changes in this MR (cite the changed line and the failing check).
- already_fixed: a later version of the MR fixes it (set fixed_in_version to that version; it must be later than this pipeline's version and not above the latest version listed).
- unrelated: infrastructure or code outside the MR (emulator boot, network, runner), not the change.
- flaky: the same test passes and fails without relevant changes.
- unknown: the log doesn't show enough.
Evidence: at most 4 items, each either `path:line` of a file in the working directory (a file name alone only when it is unique among the MR's files) or `pipeline #N` of a pipeline listed above.
retry_recommended only for unrelated or flaky. suggested_comment only when the author needs to act; otherwise an empty string.
