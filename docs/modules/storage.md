# storage
**Propósito:** esquema SQLite de la bóveda (objetos, CRDT, índice, FTS) y sus migraciones versionadas.
**Rutas:** `crates/fossil-core/src/storage.rs`, `crates/fossil-core/migrations/`
**Contratos públicos:** `open_vault(path) -> Connection` (aplica migraciones con `busy_timeout(5000)`, WAL + foreign_keys), `migrations()`.

## Esquema (0001_init.sql + 0002_fts_search.sql)
`objects` (meta, `types` como JSON array) · `object_updates` (log Yjs: `payload` BLOB + `seq`) · `object_snapshots` (compactación) · `blocks` · `links` (con CHECK de kind) · `tags` · `fts_objects` (FTS5, unicode61 remove_diacritics 2, poblando objetos activos al migrar).

## Reglas
- **Migraciones append-only:** nunca edites un archivo ya publicado; agrega `000N_*.sql` y súbelo a `migrations()`.
- `update` es palabra reservada de SQLite: la columna del log se llama **`payload`**.
- Los ids y timestamps van como TEXT (Ulid string) e INTEGER (ms UTC) respectivamente.
- Apertura SIEMPRE por `open_vault` (`busy_timeout(5000)`, WAL, foreign keys ON, migraciones).

## Gotchas
- rusqlite `bundled` trae FTS5 habilitado (lo verifica el test de migración).
- `rusqlite_migration` exige `&mut Connection` en `to_latest`.
- specta va fijado con `=` y feature `derive` explícito en fossil-core (no es default).

**ADRs relacionados:** 0004 (SQLite + espejo Markdown), 0005 (modelo de objetos)

## Metadatos (#17, #57)
`object_store::{create,get,list,update,archive}` opera sobre una conexión de bóveda.
Los filtros de tipo comparan el enum completo en JSON; la búsqueda de título es
literal (ASCII sin distinguir mayúsculas). `parent: None` no filtra; cuando `parent` es `Some`, `list` usa una consulta dedicada (`WHERE parent=?1`) para aprovechar `idx_objects_parent`.
`MetaPatch` conserva campos `None` (incluido icon); archivar es un soft delete.
Los timestamps INTEGER ms se convierten a ISO-8601 UTC con milisegundos mediante
chrono. Las actualizaciones de metadatos son transaccionales. Los IDs se validan
como Ulid en el límite; SQLite rechaza padres inexistentes mediante foreign keys.

## Ciclo de bóveda (#17)
`vault::VaultSession` conserva la conexión activa; IPC la protege con Mutex (recuperable de `PoisonError`).
Crear usa la carpeta elegida y reserva `.fossil/fossil.db` sin sobrescribirla.
El nombre vive en `.fossil/vault.json`; abrir solo acepta una base existente.
Recientes: `%APPDATA%/Fossil/config.json`, más reciente primero, sin duplicados,
escritura por archivo temporal y rename. Config corrupto se reporta sin reemplazarlo.
Una apertura fallida conserva la conexión anterior. Mutaciones emiten `object:changed`.

## Documentos Yjs (#18, #56)
`doc_store::{load, apply_update, compact}`: cada update (lib0 v1, máx. 16 MiB) se valida y se guarda en `object_updates` en transacción `Immediate`, y sube `updated_at`. `load` envuelve las lecturas en un `SAVEPOINT` para evitar lecturas partidas frente a `compact` y fusiona con `yrs::merge_updates_v1`. Al llegar a `COMPACT_AFTER_UPDATES` (200) o tras 30 s sin updates (`IdleCompaction`, contador global `AtomicU64` inmune a ABA) se compacta.

## Espejo Markdown: render (#21, #56, #57)
`markdown::render(meta, state)`: devuelve `""` si `state` está vacío; de lo contrario emite frontmatter YAML (`id`, `types`, `tags`, `created`, `updated`) y el `body` Yjs (profundidad acotada a 32) con nombres de nodo de TipTap → Markdown (encabezados, listas, tareas, citas, código y marcas `bold`/`italic`/`strike`/`code`/`link`). `relative_path` usa los títulos de los padres como carpetas, consulta hermanos directamente en SQL (`prepare_cached` sobre `idx_objects_parent`) y `safe_name` produce nombres seguros en Windows: sin `<>:"/\|?*`, sin CON/PRN/AUX/NUL/COM1-9/LPT1-9, sin punto o espacio final y con un máximo de 120 caracteres. Si dos hermanos chocan, se añade un sufijo corto del id.

## Espejo Markdown: escritura (#21, #57)
`mirror::export` / `export_tree` escribe con un archivo temporal y `rename`, y guarda en `.fossil/mirror.json` la ruta de cada objeto (leyendo y escribiendo `mirror.json` una sola vez por árbol). Al renombrar o archivar borra el `.md` anterior **antes** de escribir solo si ningún otro objeto apunta a esa ruta. Rechaza rutas que salgan de la bóveda. La app exporta 2 s después del último cambio (`MirrorDebounce`): `export_tree` al cambiar metadatos y `export` al editar el cuerpo (`object_apply_update`).

`mirror::render_object` devuelve el mismo contenido que escribe `export`, sin tocar la bóveda. Lo usa el comando `object_export_markdown` (#126, botón **Exportar Markdown**). Si el objeto no existe, devuelve `ObjectNotFound`.

## Adjuntos (#110)
`attachments::{save, load}` guardan imágenes pegadas o soltadas en `<bóveda>/attachments/<ulid>.<ext>`. El documento Yjs solo guarda la ruta relativa `attachments/…`, nunca los bytes.
- **Formatos:** png, jpg/jpeg, gif y webp. Se valida la extensión **y** los bytes mágicos.
- **Tamaño:** máximo 20 MB.
- **Escritura:** atómica, por temporal y rename. Pegar el mismo nombre dos veces nunca sobrescribe.
- **Lectura:** `load` solo acepta `attachments/<nombre>` sin `..`, subcarpetas ni separadores `\`, así que el webview no puede leer otros archivos de la bóveda.
- **IPC:** `attachment_save(fileName, bytes) -> string` y `attachment_load(path) -> number[]`. La E/S de archivos va fuera del lock de la sesión.
- **Gotcha:** los bytes viajan como arreglo JSON (igual que `object_load_doc`). Sirve para la alpha; si las imágenes grandes se notan lentas, migrar a `tauri::ipc::Response` o al protocolo `asset`.
