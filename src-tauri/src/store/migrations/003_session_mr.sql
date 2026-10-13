-- Migration 003 (M2): what GitLab said about a teammate's MR when the session was prepared
-- (title, author, created, branches, pipeline), so S-02 and S-06 show the header without asking
-- GitLab again (F-06.1, F-30.4: restoring starts no GitLab work).

ALTER TABLE sessions ADD COLUMN mr_json TEXT;
