# Spec R1: Core de objetos y almacenamiento

**Área:** `area:objects`, `area:storage` · **ADRs:** 0003, 0004, 0005

## Qué y por qué
Es el corazón de Fossil. Un objeto persistente con CRDT, guardado en SQLite, indexado y exportado a Markdown. Todo lo demás (editor, búsqueda, tareas, posts) se construye encima.

## Modelo (contrato, se fija en el issue `type:contract`)
```rust
pub struct ObjectId(Ulid);
pub struct BlockId(Ulid);
pub struct ObjectMeta {
  id: ObjectId,
  types: Vec<TypeKey>,
  title: String,
  icon: Option<String>,
  parent: Option<ObjectId>,
  created_at: i64,
  updated_at: i64,
  archived: bool,
}
pub enum TypeKey { Page, Journal, Builtin(String), Custom(Ulid) }
```
- **Cuerpo:** documento Yjs con un `Y.XmlFragment("body")` y un `Y.Map("props")`.
- **Tablas SQLite:**
  - `objects`
  - `object_updates` (blob de update Yjs + seq)
  - `object_snapshots`
  - `blocks` (id, object_id, text, order)
  - `links` (from_object, from_block, to_object, to_block, kind: wikilink | ref | embed | tag)
  - `tags`
  - `fts_objects` (FTS5)
- **Migraciones** versionadas en `crates/fossil-core/migrations/` con `rusqlite_migration`.

## Comandos IPC (R1)
- `vault_open(path)`, `vault_create(path, name)`, `vault_recent()`
- `object_create(meta) -> ObjectMeta`, `object_get(id)`, `object_list(filter)`, `object_update_meta(id, patch)`, `object_archive(id)`
- `object_load_doc(id) -> Vec<u8>` (estado Yjs) y `object_apply_update(id, update: Vec<u8>)`
- `links_backlinks(id)`, `links_unlinked_mentions(id)`
- `journal_today() -> ObjectMeta` (crea el journal del día si no existe)
- **Eventos:** `object:changed { id }`, `index:updated`

## Comportamiento
- Cada update se guarda en `object_updates` en una transacción. Al pasar de N updates (o tras 30 s de inactividad) se compacta a un snapshot.
- **Indexador** (tarea en background, con debounce de 300 ms por objeto):
  - extrae el texto plano y los bloques;
  - extrae wikilinks `[[Título]]` / `[[id]]` y tags `#tag/subtag`;
  - actualiza `links`, `tags` y FTS.
- **Espejo Markdown** (solo exportación):
  - escribe `<bóveda>/<ruta-del-árbol>/<título>.md` con frontmatter (`id`, `types`, `tags`, `created`, `updated`);
  - nombres de archivo seguros para Windows (sin caracteres reservados ni nombres como CON o PRN).
- **Bóveda:** carpeta elegida por el usuario. Las bóvedas recientes se guardan en `%APPDATA%/Fossil/config.json`.

## Criterios de aceptación
- Crear, editar, cerrar y reabrir la app conserva el contenido exacto (test de integración).
- 10 000 objetos sintéticos: abrir la bóveda tarda < 1 s y la búsqueda FTS < 50 ms (benchmark con `criterion`).
- Dos updates concurrentes aplicados en distinto orden convergen al mismo estado (proptest).
- El `.md` exportado refleja el contenido unos 2 s después de editar y se abre bien en cualquier editor de Markdown.

## Fuera de alcance
Tipos personalizados y relaciones tipadas (R2), sync (R3), importación de Markdown (R2/R7).
