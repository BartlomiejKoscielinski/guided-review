-- Migration 009 (M5, F-12.5 Publish): the text a draft's GitLab draft note carries. A note made by
-- a failed Publish attempt is reused by the Retry only while it still says what the draft says;
-- after an edit it is deleted and made again, so GitLab never publishes text the user changed.
-- (The summary comment keeps the same in `sessions.summary_json`, `$.gitlabDraftText`.)

ALTER TABLE drafts ADD COLUMN gitlab_draft_note TEXT;
