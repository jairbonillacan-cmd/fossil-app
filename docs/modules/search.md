# search
**Propósito:** contrato de búsqueda de texto completo (FTS5), indexación en background y motor con parser de operadores (`docs/specs/r1-search.md`, #92, #20).
**Rutas:** `crates/fossil-core/src/search.rs`, `crates/fossil-core/benches/search_10k.rs`, `crates/fossil-core/migrations/0002_fts_search.sql`, `apps/desktop/src-tauri/src/commands/search.rs`.
**Contratos públicos:** `commands.searchQuery(query: SearchQuery) -> Result<SearchHit[], SearchError>` y los filtros guardados `searchFiltersList/Save/Delete` (§Filtros guardados) en `apps/desktop/src/bindings.ts`.

## Indexador en background (#19, `crates/fossil-core/src/indexer.rs`)
- `extract_blocks(object_id, state)` recorre `Y.XmlFragment("body")` (ADR-0015) con `blockId` o fallback `<object_id>:<sort_order>`.
- `index_object(conn, id)` actualiza `blocks`, `links`, `tags` (minúsculas) y `fts_objects` en una transacción SQLite.
- Texto plano sin marcas de formato (`plain_text` recorre `diff()`, igual que el espejo): un `#tag` o `[[enlace]]` en negrita se indexa igual.
- `blocks.id` es global: un bloque pegado desde otra página (mismo `blockId`) nunca borra la fila ajena; la copia se guarda como `<object_id>:<blockId>`.
- Debounce de 300 ms sin polling (`INDEX_DEBOUNCE` en `commands/objects.rs`, claves `index:<id>` sobre las generaciones de `IdleCompaction`) → evento `index:updated`.
- `backlinks(conn, id)`: enlaces entrantes desde **otras** páginas no archivadas (un autoenlace no cuenta).
- `unlinked_mentions(conn, id)`: páginas que mencionan el título por **palabras completas** (`contains_words`, límites Unicode) sin enlazarlo; pre-filtra candidatos con `fts_objects MATCH` cuando el título contiene tokens alfanuméricos y descarta bloques de objetos ya vistos (`seen.contains(&oid)`) antes de limpiar wikilinks.
- `resolve_target(conn, target)`: resuelve primero por `id` (PK) y `lower(trim(title)) = ?1` con `prepare_cached`, cayendo a `length(trim(title))` solo si el objetivo no es ASCII.
- **Pendiente:** reindexado inicial de objetos existentes al abrir el Espacio.

## Tipos (`fossil-core`, `specta`)
- `SearchQuery`: `text: String`, `type_key: Option<TypeKey>`, `tag: Option<String>`, `updated_from: Option<String>`, `updated_to: Option<String>`, `limit: Option<u32>` (`DEFAULT_SEARCH_LIMIT = 50`, `MAX_SEARCH_LIMIT = 200`).
- `SnippetPart`: `text: String`, `matched: bool` (segmentos de texto plano para renderizar resaltado en React sin `dangerouslySetInnerHTML`).
- `SearchHit`: `object_id: ObjectId`, `title: String`, `snippet: Vec<SnippetPart>`, `score: f64` (`-bm25`, mayor = más relevante).
- `SearchError`: `NotImplemented` (stub hasta #20), `VaultNotOpen`, `InvalidQuery(String)`, `Storage(String)`, y para filtros guardados `InvalidFilterName(String)`, `DuplicateFilterName(String)`, `FilterNotFound(String)`.

## Filtros guardados (#127, `crates/fossil-core/src/saved_filters.rs`)
- **Son del Espacio**, no de la persona: tabla `saved_search_filters` (migración `0004`) dentro de la bóveda; con la sincronización (R3) los verá todo el equipo.
- **Tipos:** `SavedFilter { id: SavedFilterId /* Ulid */, name, query: SearchQuery }` y `SavedFilterDraft { id: SavedFilterId | null, name, query }`.
- **Comandos:** `search_filters_list() -> SavedFilter[]` (orden por nombre sin mayúsculas, luego id) · `search_filters_save(filter: SavedFilterDraft) -> SavedFilter` (`id: null` crea con Ulid nuevo; `id` existente reemplaza nombre y consulta; `id` desconocido o mal formado → `FilterNotFound`) · `search_filters_delete(id)` (`FilterNotFound` si no existe).
- **Nombre:** se recorta; vacío, con caracteres de control o con más de `MAX_FILTER_NAME_CHARS` (80) caracteres → `InvalidFilterName`. Duplicado sin distinguir mayúsculas (Unicode: `Campaña` = `CAMPAÑA`, columna `name_key` única) → `DuplicateFilterName`; renombrar el mismo filtro cambiando solo mayúsculas sí vale.
- **Consulta** (`normalize_query`, → `InvalidQuery`): `text` ≤ `MAX_FILTER_TEXT_CHARS` (1000); `tag` y la clave de `Builtin`/`Custom` de 1 a 100 caracteres imprimibles, y el tag debe pasar `clean_tag`; fechas ISO-8601 válidas con `updated_from <= updated_to`; `limit: 0` se rechaza y `limit` mayor que `MAX_SEARCH_LIMIT` se acota a 200, igual que en `search_query`. Se guarda ya normalizada (JSON, `CHECK json_valid`).
- **Trampa:** `list` salta filas con id que no es Ulid o JSON que no deserializa (dato hostil) en lugar de fallar toda la lista. Guardar va en transacción `Immediate`: un rechazo no escribe nada.

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
- En `search_query`, la consulta común (≤1 `type` y ≤1 `tag`) evita `json_each` por fila y usa `+t.tag` para forzar el índice cubriente `PRIMARY KEY (object_id, tag)` en lugar de `idx_tags_tag`.
- El presupuesto de rendimiento con 10 000 objetos (`crates/fossil-core/benches/search_10k.rs`) es **< 50 ms (p95)** en búsqueda y **< 1 s** al abrir el Espacio (`docs/DOD.md`).

**ADRs relacionados:** 0004 (SQLite + FTS5), 0005 (modelo de objetos)
