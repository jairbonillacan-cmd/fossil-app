# core
**Propósito:** núcleo local-first de Fossil: almacenamiento SQLite + FTS5, CRDT Yjs (`yrs`), indexador del grafo, bitácora diaria, espejo Markdown e IPC de objetos.
**Rutas:** `crates/fossil-core/src/`, `crates/fossil-core/migrations/`, `apps/desktop/src-tauri/src/commands/objects.rs`
**Contratos públicos:** `open_vault`, `object_store::*`, `doc_store::*`, `indexer::*`, `journal::*`, `markdown::*`, `mirror::*`, y comandos IPC en `apps/desktop/src/bindings.ts`.

## Archivos clave
- `crates/fossil-core/src/storage.rs` — abre `.fossil/fossil.db` con `busy_timeout(5000)`, WAL, `foreign_keys = ON` y migraciones (`0001_init.sql`, `0002_fts_search.sql` con backfill de objetos no archivados).
- `crates/fossil-core/src/doc_store.rs` — persistencia Yjs (`object_updates` + `object_snapshots`): `load` usa `SAVEPOINT` para lecturas consistentes; `apply_update` y `compact` usan `TransactionBehavior::Immediate` y cota de 16 MiB por update.
- `crates/fossil-core/src/indexer.rs` — extrae bloques (profundidad XML ≤ 32, desambiguando IDs repetidos en la misma página con `#2`, `#3`), wikilinks (sin que páginas archivadas reclamen enlaces pendientes), tags y FTS5.
- `crates/fossil-core/src/journal.rs` — bitácora diaria (`YYYY-MM-DD`); al desarchivar una bitácora existente devuelve `created = true` para actualizar FTS5 y espejo.
- `crates/fossil-core/src/markdown.rs` y `mirror.rs` — renderizado (`render` devuelve `""` si `state` está vacío; árbol XML acotado a 32 niveles) y exportación atómica a `.md`.
- `apps/desktop/src-tauri/src/commands/objects.rs` — estado `VaultState` (recuperable ante `PoisonError`) y debounce con `Generations` monotónico global (`AtomicU64`, inmune a ABA).

## Cómo probar
- `cargo nextest run -p fossil-core`
- `cargo nextest run -p fossil-desktop`

## Gotchas
- `tauri_plugin_single_instance` debe registrarse como primer `.plugin(...)` en `tauri::Builder::default()`.
- Los Espacios recientes se guardan en `%APPDATA%\Fossil\config.json` mediante archivo temporal y `rename`.

**ADRs relacionados:** 0003, 0004, 0005
