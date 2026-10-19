-- Migration 010 (M5, F-12.5 Publish, decision 10b): the version a draft's GitLab draft note was
-- placed on (`base_sha start_sha head_sha` of its position; NULL for a note without a position). A
-- note made by a failed Publish attempt is reused only on that version; after the MR moved on, the
-- next Publish deletes it and makes it again at the re-mapped position.

ALTER TABLE drafts ADD COLUMN gitlab_draft_refs TEXT;
