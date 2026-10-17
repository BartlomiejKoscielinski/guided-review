-- Migration 008 (M5, S-05 publishing): what S-05 keeps per session and per draft.
-- `sessions.summary_json` (F-12.4, M5 decision 11): the "Add a summary comment" tick, its text and
-- whether Claude suggested it, as JSON `{"enabled","text","suggested"}`; NULL reads as unticked.
-- `drafts.gitlab_draft_id`, `drafts.published_at`, `drafts.outdated` (F-12.5, plan M5): the GitLab
-- draft note made by an earlier Publish attempt, when the draft was published, and a draft whose
-- line is gone from a newer version of the MR.

ALTER TABLE sessions ADD COLUMN summary_json TEXT;
ALTER TABLE drafts ADD COLUMN gitlab_draft_id INTEGER;
ALTER TABLE drafts ADD COLUMN published_at TEXT;
ALTER TABLE drafts ADD COLUMN outdated INTEGER NOT NULL DEFAULT 0;
