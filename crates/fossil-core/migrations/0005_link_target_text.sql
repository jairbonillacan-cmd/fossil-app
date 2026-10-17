-- Raw wikilink target (r1-safe-rename, #128): the text between `[[` and the
-- first `#` or `|`, trimmed, with its original casing. `to_object` keeps the
-- resolved id (or the lowercased title when nothing resolves); this column
-- lets links_broken tell title-form links (which can be Ambiguous) from
-- id-form ones and report what the person wrote. NULL for rows indexed
-- before 0005 and for non-wikilink kinds; the indexer fills it on re-index.
ALTER TABLE links ADD COLUMN target_text TEXT
  CHECK (target_text IS NULL OR length(trim(target_text)) > 0);
