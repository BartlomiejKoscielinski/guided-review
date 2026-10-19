Merge request !{{iid}} "{{title}}" has open review threads that were written on an older version. Some later commits may have done what a thread asks for.
The threads to check (id, place, the later commits that may have addressed it, the notes): {{threads_file}}
Those commits, oldest first, with their diffs (long diffs are cut): {{commits_file}}

addressed: one entry for each thread a later commit clearly addressed, and only those; an empty list when none is. discussion_id: the thread's id as written in the threads file. commit: the full id of the commit that addressed it, one of that thread's later commits. hint: what that commit did about it in 2–5 plain words, lower case, no full stop and no commit id (for example "index added"; the app adds "in <commit>"). When in doubt, leave the thread out: a commit that only touches its lines does not address it.
Never decide that a thread should be resolved; the reviewer does that.
