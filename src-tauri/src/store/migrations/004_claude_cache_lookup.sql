-- Migration 004 (M3): lookup columns for claude_cache, so S-01 can say "plan is ready" (F-02.5,
-- M3 decision 7) for a list row, which knows only the repository, the iid and diffHeadSha.
-- The key stays the SHA-256 of docs/04 › Claude cache key.

ALTER TABLE claude_cache ADD COLUMN repo_id INTEGER;
ALTER TABLE claude_cache ADD COLUMN subject TEXT;
ALTER TABLE claude_cache ADD COLUMN head_sha TEXT;
ALTER TABLE claude_cache ADD COLUMN model TEXT;
ALTER TABLE claude_cache ADD COLUMN effort TEXT;
ALTER TABLE claude_cache ADD COLUMN prompt_version INTEGER;
CREATE INDEX claude_cache_lookup ON claude_cache (task, repo_id, subject, head_sha);
