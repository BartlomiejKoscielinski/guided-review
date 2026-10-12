For each open discussion thread on merge request !{{iid}}, decide whether a later commit appears to address it.
Open threads (discussion_id, file:line, first message, replies, the commit the thread was written against): {{threads_file}}
Commits pushed after those threads, with their diffs: {{commits_file}}

For each thread return:
- addressed: true only if a later change clearly does what the thread asks; when in doubt, false.
- commit: the short SHA of that change, or an empty string.
- hint: at most 60 characters naming what changed, e.g. "index added in a91f2c0", or an empty string.
Never decide that a thread should be resolved; the reviewer does that.
