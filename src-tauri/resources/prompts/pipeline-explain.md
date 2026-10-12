A CI job failed for merge request !{{iid}} (version {{version}}, commit {{sha}}). Explain why.
Job: {{job_name}} in stage {{stage}} (allowed to fail: {{allow_failure}}).
Job log tail: {{log_file}}
Test report summary (may be empty): {{test_report_file}}
MR diff: {{diff_file}}
Other pipelines of this MR and their results: {{pipelines_summary}}

Decide the verdict:
- caused_by_mr: the failure follows from changes in this MR (cite the changed line and the failing check).
- already_fixed: a later version of the MR fixes it (set fixed_in_version).
- unrelated: infrastructure or code outside the MR (emulator boot, network, runner), not the change.
- flaky: the same test passes and fails without relevant changes.
- unknown: the log doesn't show enough.
retry_recommended only for unrelated or flaky. suggested_comment only when the author needs to act; otherwise an empty string.
