-- Migration 007 (M4, F-07.10): each file of a step can be marked reviewed on its own. The files of
-- a step marked on their own, a JSON array of repository-relative paths; the step's `reviewed`
-- flag stays what the steps list counts and is set once all its files are marked.

ALTER TABLE steps_state ADD COLUMN files_json TEXT;
