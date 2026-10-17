# storage
**Propósito:** esquema SQLite de la bóveda (objetos, CRDT, índice, FTS) y sus migraciones versionadas.
**Rutas:** `crates/fossil-core/src/storage.rs`, `crates/fossil-core/migrations/`
**Contratos públicos:** `open_vault(path) -> Connection` (aplica migraciones con `busy_timeout(5000)`, WAL + foreign_keys), `migrations()`.

## Esquema (0001_init.sql … 0004_saved_search_filters.sql)
`objects` (meta, `types` como JSON array) · `object_updates` (log Yjs: `payload` BLOB + `seq`) · `object_snapshots` (compactación) · `blocks` · `links` (con CHECK de kind) · `tags` · `fts_objects` (FTS5, unicode61 remove_diacritics 2, poblando objetos activos al migrar) · `object_versions` y `workspace_snapshots` (0003, ver §Confianza de datos) · `saved_search_filters` (0004, filtros guardados del Espacio; ver `docs/modules/search.md`).

## Reglas
- **Migraciones append-only:** nunca edites un archivo ya publicado; agrega `000N_*.sql` y súbelo a `migrations()`.
- `update` es palabra reservada de SQLite: la columna del log se llama **`payload`**.
- Los ids y timestamps van como TEXT (Ulid string) e INTEGER (ms UTC) respectivamente.
- Apertura SIEMPRE por `open_vault` (`busy_timeout(5000)`, WAL, foreign keys ON, migraciones).

## Gotchas
- rusqlite `bundled` trae FTS5 habilitado (lo verifica el test de migración).
- `rusqlite_migration` exige `&mut Connection` en `to_latest`.
- specta va fijado con `=` y feature `derive` explícito en fossil-core (no es default).

**ADRs relacionados:** 0004 (SQLite + espejo Markdown), 0005 (modelo de objetos), 0018 (snapshots con `VACUUM INTO`)

## Metadatos (#17, #57, #118)
`object_store::{create,get,list,update,archive,move_object}` opera sobre una conexión de bóveda.
Los filtros de tipo comparan el enum completo en JSON; la búsqueda de título es
literal (ASCII sin distinguir mayúsculas). `parent: None` no filtra; cuando `parent` es `Some`, `list` usa una consulta dedicada (`WHERE parent=?1`) para aprovechar `idx_objects_parent`.
`MetaPatch` conserva campos `None` (incluido icon); archivar es un soft delete.
`move_object(conn, id, parent)` (IPC `objectMove(id: ObjectId, parent: string | null) -> ObjectMeta`,
`null` = raíz) reparenta en una transacción y no escribe nada si falla. Errores tipados:
`ObjectNotFound` (el objeto), `ParentNotFound` (padre o ancestro inexistente; un id de otro
Espacio cae aquí, cada Espacio es su propia base), `ParentArchived` (padre o ancestro archivado),
`MoveCycle` (dentro de sí mismo, de un descendiente o de un ciclo previo; acota el recorrido).
Idempotente si el padre no cambia. **Orden entre hermanos:** no hay columna de posición (orden
manual fuera de alcance); el orden es el derivado `updated_at DESC, id`, total y sin huecos. Mover
sube `updated_at` por encima del hermano más reciente, así que el movido queda primero y los demás
conservan su orden. El IPC emite `object:changed` y programa `export_tree`: el `.md` y su subárbol
pasan a la carpeta del nuevo padre. Enlaces y backlinks van por id, así que no cambian.
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
**Trampa:** `mirror::inside` es la única puerta de `remove`/`export`: solo acepta rutas relativas de componentes normales **con extensión `.md`**, nunca bajo `.fossil` ni `attachments` (incluso con puntos o espacios finales), y aplica `fs_guard::reject_link` a cada prefijo — una entrada manipulada del índice no debe tocar internos ni seguir enlaces. `safe_name` reserva `.fossil` y `attachments` (con `_`) para que ningún título de página raíz choque con esas carpetas.

`mirror::render_object` devuelve el mismo contenido que escribe `export`, sin tocar la bóveda. Lo usa el comando `object_export_markdown` (#126, botón **Exportar Markdown**). Si el objeto no existe, devuelve `ObjectNotFound`.

## Adjuntos (#110)
`attachments::{save, load}` guardan imágenes pegadas o soltadas en `<bóveda>/attachments/<ulid>.<ext>`. El documento Yjs solo guarda la ruta relativa `attachments/…`, nunca los bytes.
- **Formatos:** png, jpg/jpeg, gif y webp. Se valida la extensión **y** los bytes mágicos.
- **Tamaño:** máximo 20 MB.
- **Escritura:** atómica, por temporal y rename. Pegar el mismo nombre dos veces nunca sobrescribe.
- **Lectura:** `load` solo acepta `attachments/<nombre>` sin `..`, subcarpetas ni separadores `\`, así que el webview no puede leer otros archivos de la bóveda. Antes de leer o escribir se verifica con `fs_guard::reject_link` que ni `attachments/` ni el archivo sean un enlace (junction/symlink).
- **IPC:** `attachment_save(fileName, bytes) -> string` y `attachment_load(path) -> number[]`. La E/S de archivos va fuera del lock de la sesión.
- **Gotcha:** los bytes viajan como arreglo JSON (igual que `object_load_doc`). Sirve para la alpha; si las imágenes grandes se notan lentas, migrar a `tauri::ipc::Response` o al protocolo `asset`.

## Confianza de datos: contrato (#160, spec `r1-trust`)
Solo contrato: tablas, tipos y comandos stub. Los motores llegan con `r1-snapshots`, `r1-page-history`, `r1-save-chaos` y `r1-mirror-roundtrip`.
- **`object_versions`** (Historial de versiones, distinta de `object_snapshots` de compactación): `version_id` Ulid, `object_id` FK con `ON DELETE CASCADE`, `title`, `trigger_kind`, `payload` (estado yrs completo, `encode_state_as_update_v1`), `plain_excerpt`, `byte_size`, `created_at` ms. Índice `(object_id, created_at DESC)`.
- **`workspace_snapshots`**: `snapshot_id` Ulid, `snapshot_path`, `trigger_kind`, `object_count`, `attachment_count`, `total_bytes`, `integrity_ok` (0/1), `created_at` ms. Índice `created_at DESC`.
- **Ajuste a la spec:** `CHECK` en `trigger_kind` (etiquetas snake_case), en conteos no negativos y en `integrity_ok IN (0,1)`, igual que `links.kind`.
- **Tipos** (`fossil_core::snapshots`, specta): `SaveStatus{kind, failed_seq, last_error}` / `SaveStatusKind{Saved,Saving,Error}` (exportado con `.typ::<SaveStatus>()` porque ningún comando lo usa), `SnapshotTriggerKind{Manual,Scheduled,PreImport,PreRestore}`, `VersionTriggerKind{IdlePause,SignificantEdit,SessionClose,PreRestore,Manual}`, `RestoreConflictPolicy{CreateCopy,OverwriteWithBackupVersion}`, `WorkspaceSnapshotMeta`, `PageVersionSummary`, `PageVersionDiff`, `MirrorUnsupportedItem`, `MirrorRoundtripReport`. En SQLite los enums se guardan con `as_sql()` y se leen con `from_sql()` (devuelve `None` ante etiquetas desconocidas: dato hostil).
- **Comandos** (`commands/snapshots.rs`, hoy `CoreError::NotImplemented`): `snapshot_create(trigger_kind)` · `snapshot_list()` · `snapshot_restore_workspace(snapshot_id, target_dir) -> VaultInfo` · `snapshot_restore_page(snapshot_id, object_id, policy) -> ObjectMeta` · `snapshot_restore_attachment(snapshot_id, relative_path) -> string` · `page_version_list(object_id)` · `page_version_diff(object_id, version_id)` · `page_version_restore(object_id, version_id) -> ObjectMeta` · `mirror_roundtrip_verify()`.
- **Trampas:** `object_id` va como `ObjectId` (no `String` como en la spec), igual que el resto del contrato. `total_bytes` es `f64` porque specta prohíbe enteros de 64 bits; specta lo exporta como `number | null` (un `NaN` se serializa como `null`): el motor nunca debe producir `NaN` y la UI trata `null` como desconocido. El snapshot de SQLite es **solo** `VACUUM INTO` sobre una conexión de solo lectura + `PRAGMA quick_check` (ADR-0018); nunca `std::fs::copy` en caliente. `target_dir` y `relative_path` pasan por `fs_guard` y por el `manifest.json` antes de usarse.
