-- Migration 006 (M4, F-08.3): the S-04 rail's first item "Change overview" is done once S-02
-- showed the session's plan (`plan_opened_at`, the first time it did), and each step counts its
-- drafts (`drafts.step_id`: the note's step, or the step holding the hunk of the draft's line;
-- NULL for a comment on the merge request or a line in no step).

ALTER TABLE sessions ADD COLUMN plan_opened_at TEXT;
ALTER TABLE drafts ADD COLUMN step_id TEXT;
