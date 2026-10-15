-- Fossil vault schema v1 (spec r1-objects-storage, ADR-0004).
CREATE TABLE objects (
  id         TEXT PRIMARY KEY,
  types      TEXT NOT NULL,             -- JSON array of TypeKey
  title      TEXT NOT NULL,
  icon       TEXT,
  parent     TEXT REFERENCES objects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_objects_parent ON objects(parent);
CREATE INDEX idx_objects_updated ON objects(updated_at DESC);

-- Yjs update log; compacted into object_snapshots.
-- Column is `payload` (not `update`) because UPDATE is an SQLite keyword.
CREATE TABLE object_updates (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  payload   BLOB NOT NULL
);
CREATE INDEX idx_updates_object ON object_updates(object_id, seq);

CREATE TABLE object_snapshots (
  object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  state     BLOB NOT NULL,
  at_seq    INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Flat block index extracted by the indexer.
CREATE TABLE blocks (
  id         TEXT PRIMARY KEY,
  object_id  TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_blocks_object ON blocks(object_id, sort_order);

CREATE TABLE links (
  from_object TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  from_block  TEXT,
  to_object   TEXT NOT NULL,
  to_block    TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('wikilink', 'ref', 'embed', 'tag')),
  PRIMARY KEY (from_object, from_block, to_object, kind)
);
CREATE INDEX idx_links_to ON links(to_object, kind);

CREATE TABLE tags (
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (object_id, tag)
);
CREATE INDEX idx_tags_tag ON tags(tag);

-- Full-text index over titles and plain-text bodies.
CREATE VIRTUAL TABLE fts_objects USING fts5(
  object_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61'
);
