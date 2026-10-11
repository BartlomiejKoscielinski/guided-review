-- Migration 001: the initial schema from docs/04-architecture.md › SQLite schema, verbatim.
-- Never edit an applied migration; add a new one instead.

CREATE TABLE settings      (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE repos         (id INTEGER PRIMARY KEY, name TEXT, path TEXT UNIQUE, gitlab_project TEXT, is_default INTEGER DEFAULT 0,
                            worktree_root TEXT);
CREATE TABLE worktrees     (path TEXT PRIMARY KEY, repo_id INTEGER, kind TEXT /*review|fix*/, project TEXT, iid INTEGER,
                            head_sha TEXT, created_at TEXT, last_used_at TEXT);
CREATE TABLE sessions      (id TEXT PRIMARY KEY, repo_id INTEGER, source_json TEXT, base_sha TEXT, head_sha TEXT, start_sha TEXT,
                            mr_version_id INTEGER, worktree TEXT, mode TEXT, layout TEXT, strategy TEXT, status TEXT,
                            current_step TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE plans         (session_id TEXT PRIMARY KEY, plan_json TEXT, custom_order_json TEXT);
CREATE TABLE steps_state   (session_id TEXT, step_id TEXT, reviewed INTEGER, scroll INTEGER, checklist_json TEXT,
                            PRIMARY KEY (session_id, step_id));
CREATE TABLE findings      (id TEXT PRIMARY KEY, session_id TEXT, step_id TEXT, json TEXT, kind TEXT, decision TEXT, fingerprint TEXT);
CREATE TABLE drafts        (id TEXT PRIMARY KEY, session_id TEXT, finding_id TEXT, body TEXT, position_json TEXT, severity TEXT,
                            include INTEGER, published_note_id INTEGER, error TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE claude_cache  (key TEXT PRIMARY KEY, task TEXT, result_json TEXT, session_ref TEXT, created_at TEXT);
CREATE TABLE claude_sessions (session_id TEXT, step_id TEXT, claude_session_id TEXT, PRIMARY KEY (session_id, step_id));
CREATE TABLE dismissals    (fingerprint TEXT, kind TEXT, mr TEXT, file TEXT, created_at TEXT);
CREATE TABLE rule_suggestions (id TEXT PRIMARY KEY, kind TEXT, line TEXT, evidence_json TEXT, state TEXT, updated_at TEXT);
CREATE TABLE poll_state    (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE queued_replies(id TEXT PRIMARY KEY, project TEXT, iid INTEGER, discussion_id TEXT, body TEXT, resolve INTEGER,
                            after_sha TEXT, state TEXT, error TEXT);
CREATE TABLE job_variables (project TEXT, job_name TEXT, vars_json TEXT, updated_at TEXT, PRIMARY KEY (project, job_name));
