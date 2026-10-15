-- Migration 005 (M3): a note is kept per review session (F-09.4). A note's ID is a hash of the
-- step ID, its position and its fingerprint, so an MR review and a commit review (or two sessions
-- of one MR) can raise a note with the same ID; each keeps its own decision, and a dismissal is
-- recorded and undone under its own review's subject. SQLite cannot change a primary key, so the
-- table is rebuilt with the same columns, in the same order.

CREATE TABLE findings_005 (id TEXT, session_id TEXT, step_id TEXT, json TEXT, kind TEXT, decision TEXT,
                           fingerprint TEXT, PRIMARY KEY (session_id, id));
INSERT INTO findings_005 (id, session_id, step_id, json, kind, decision, fingerprint)
    SELECT id, session_id, step_id, json, kind, decision, fingerprint FROM findings ORDER BY rowid;
DROP TABLE findings;
ALTER TABLE findings_005 RENAME TO findings;
