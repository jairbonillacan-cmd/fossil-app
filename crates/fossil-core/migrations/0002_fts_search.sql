-- Upgrade FTS5 virtual table to fold all Latin diacritics including ñ -> n
-- and weight titles higher than bodies by default (spec r1-search, #92).
DROP TABLE IF EXISTS fts_objects;

CREATE VIRTUAL TABLE fts_objects USING fts5(
  object_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO fts_objects(fts_objects, rank) VALUES ('rank', 'bm25(10.0, 1.0)');

INSERT INTO fts_objects (object_id, title, body)
SELECT
  o.id,
  o.title,
  COALESCE(
    (SELECT group_concat(b.text, char(10))
     FROM (SELECT text FROM blocks WHERE object_id = o.id ORDER BY sort_order) b),
    ''
  )
FROM objects o
WHERE o.archived = 0;

