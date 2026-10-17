-- Saved search filters of the Espacio (#127, r1-search-rank). They belong to the
-- vault, not to a person: the whole team will see them once sync arrives (R3).
-- name_key is the Unicode-lowercased trimmed name, so "Campaña" and "CAMPAÑA"
-- collide (COLLATE NOCASE only folds ASCII). query is a SearchQuery as JSON.
CREATE TABLE saved_search_filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) > 0),
  name_key TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL CHECK (json_valid(query)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
