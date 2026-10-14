# search
**Propósito:** contrato de búsqueda de texto completo (FTS5), indexación en background y motor con parser de operadores (`docs/specs/r1-search.md`, #92, #20).
**Rutas:** `crates/fossil-core/src/search.rs`, `crates/fossil-core/benches/search_10k.rs`, `crates/fossil-core/migrations/0002_fts_search.sql`, `apps/desktop/src-tauri/src/commands/search.rs`.
**Contratos públicos:** `commands.searchQuery(query: SearchQuery) -> Result<SearchHit[], SearchError>` en `apps/desktop/src/bindings.ts`.

## Indexador en background (#19, `crates/fossil-core/src/indexer.rs`)
- `extract_blocks(object_id, state)` recorre `Y.XmlFragment("body")` (ADR-0015) con `blockId` o fallback `<object_id>:<sort_order>`.
- `index_object(conn, id)` actualiza `blocks`, `links`, `tags` (minúsculas) y `fts_objects` en una transacción SQLite.
- Texto plano sin marcas de formato (`plain_text` recorre `diff()`, igual que el espejo): un `#tag` o `[[enlace]]` en negrita se indexa igual.
- `blocks.id` es global: un bloque pegado desde otra página (mismo `blockId`) nunca borra la fila ajena; la copia se guarda como `<object_id>:<blockId>`.
- Debounce de 300 ms sin polling (`INDEX_DEBOUNCE` en `commands/objects.rs`, claves `index:<id>` sobre las generaciones de `IdleCompaction`) → evento `index:updated`.
- `backlinks(conn, id)`: enlaces entrantes desde **otras** páginas no archivadas (un autoenlace no cuenta).
- `unlinked_mentions(conn, id)`: páginas que mencionan el título por **palabras completas** (`contains_words`, límites Unicode) sin enlazarlo.
- **Pendiente:** reindexado inicial de objetos existentes al abrir la bóveda; `resolve_target` y `unlinked_mentions` recorren tablas completas (prefiltrar con FTS si crece la bóveda).

## Tipos (`fossil-core`, `specta`)
- `SearchQuery`: `text: String`, `type_key: Option<TypeKey>`, `tag: Option<String>`, `updated_from: Option<String>`, `updated_to: Option<String>`, `limit: Option<u32>` (`DEFAULT_SEARCH_LIMIT = 50`, `MAX_SEARCH_LIMIT = 200`).
- `SnippetPart`: `text: String`, `matched: bool` (segmentos de texto plano para renderizar resaltado en React sin `dangerouslySetInnerHTML`).
- `SearchHit`: `object_id: ObjectId`, `title: String`, `snippet: Vec<SnippetPart>`, `score: f64` (`-bm25`, mayor = más relevante).
- `SearchError`: `NotImplemented` (stub hasta #20), `VaultNotOpen`, `InvalidQuery(String)`, `Storage(String)`.

## Esquema FTS5 (`0002_fts_search.sql`)
Recreación de `fts_objects(object_id UNINDEXED, title, body)` con `tokenize = 'unicode61 remove_diacritics 2'` (para que `"campaña"` coincida con `"campana"`) y `rank = 'bm25(10.0, 1.0)'` (título con 10× más peso que el cuerpo).

## Gramática del parser de operadores (`parse_search_text`, `search_query`, #92, #20)
```ebnf
query       = ws , [ clause , { ws1 , clause } ] , ws ;
clause      = tag_filter | type_filter | negated | phrase | word ;
tag_filter  = "tag:" , [ "#" ] , token ;
type_filter = "type:" , token ;
negated     = "-" , ( phrase | word ) ;
phrase      = '"' , { char - '"' } , '"' ;
word        = token ;
token       = ( char - ws_char - '"' ) , { char - ws_char - '"' } ;
```
- **Semántica:**
  - `word` y `phrase` positivas se combinan con `AND` implícito en FTS5; cada término se envuelve como frase escapada en FTS5 para evitar inyección de operadores (`NEAR`, `OR`, paréntesis desbalanceados).
  - `negated` (`-excluir`, `-"frase"`) se traduce a `NOT "..."` en FTS5.
  - `tag:x` (con o sin `#` inicial) filtra objetos que tengan `tag = x` (o subtag `x/...`) en la tabla `tags`; se intersecta (`AND`) con `SearchQuery.tag`.
  - `type:journal` / `type:page` / `type:<key>` filtra por `TypeKey` (`page` → `Page`, `journal` → `Journal`, otro → `Builtin`), intersectado con `SearchQuery.type_key`.
  - Comillas sin cerrar (`"frase parcial`) toman el resto de la cadena como frase; tokens incompletos (`-`, `tag:`, `type:`) se ignoran para no fallar mientras el usuario escribe (debounce de 80 ms).

## Reglas y gotchas
- `updated_from` y `updated_to` viajan como strings ISO-8601 UTC (specta-typescript prohíbe `i64`) y se convierten a milisegundos UTC en la capa SQLite.
- `SearchHit.snippet` devuelve `Vec<SnippetPart>` (`parse_snippet` sobre `snippet(fts_objects, -1, char(1), char(2), '…', 16)`), nunca HTML crudo, evitando XSS en la WebView.
- El presupuesto de rendimiento con 10 000 objetos (`crates/fossil-core/benches/search_10k.rs`) es **< 50 ms (p95)** en búsqueda y **< 1 s** al abrir la bóveda (`docs/DOD.md`).

**ADRs relacionados:** 0004 (SQLite + FTS5), 0005 (modelo de objetos)
