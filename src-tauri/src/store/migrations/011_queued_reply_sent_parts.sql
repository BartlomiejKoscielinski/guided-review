-- Migration 011 (M7, F-26.5 Push and reply): which part of a queued reply GitLab already took. A
-- reply whose note was posted but whose Resolve failed stays `queued`; the retry resolves the
-- thread without posting the note a second time.

ALTER TABLE queued_replies ADD COLUMN replied INTEGER NOT NULL DEFAULT 0;
