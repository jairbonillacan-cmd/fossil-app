-- Local page history and workspace snapshots (spec r1-trust, #160, ADR-0018).
-- object_versions is separate from object_snapshots (compaction): a version is a
-- full yrs state (encode_state_as_update_v1) kept for the Historial de versiones.
CREATE TABLE object_versions (
  version_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN
    ('idle_pause', 'significant_edit', 'session_close', 'pre_restore', 'manual')),
  payload BLOB NOT NULL,
  plain_excerpt TEXT NOT NULL DEFAULT '',
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_object_versions_lookup ON object_versions (object_id, created_at DESC);

-- One row per sealed snapshot under .fossil/backups/<snapshot_id>/ (or an external folder).
CREATE TABLE workspace_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  snapshot_path TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN
    ('manual', 'scheduled', 'pre_import', 'pre_restore')),
  object_count INTEGER NOT NULL CHECK (object_count >= 0),
  attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
  total_bytes INTEGER NOT NULL CHECK (total_bytes >= 0),
  integrity_ok INTEGER NOT NULL DEFAULT 1 CHECK (integrity_ok IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_workspace_snapshots_created ON workspace_snapshots (created_at DESC);
