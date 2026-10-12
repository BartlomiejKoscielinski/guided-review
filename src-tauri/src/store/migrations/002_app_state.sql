-- Migration 002 (M1): state the app keeps for itself, not user settings, e.g. the Claude Code
-- version of the last successful startup probe (docs/04 › SQLite schema, docs/05 › Startup checks).

CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
