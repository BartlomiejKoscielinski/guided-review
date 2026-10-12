The reviewer looked up the usages of {{symbol}} ({{symbol_kind}}, defined at {{definition_location}}) while reviewing step {{step_number}} ("{{step_title}}") of {{source_label}}.
How the symbol changed in this change: {{change_summary_file}}
Usages inside this change: {{usages_in_change_file}}
Usages outside this change (code that was not modified): {{usages_outside_file}}

Decide whether any usage outside this change may now behave differently: a changed signature or contract, new exceptions, different timing or threading, behaviour the callers rely on. Read those call sites before deciding.

insight: one or two sentences for the reviewer, citing file:line, or an empty string if nothing outside the change is affected.
affected: the usages outside the change you consider affected (file, line).
question: a question the reviewer could post to the author as is, or an empty string.
