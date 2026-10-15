# objects
**Propósito:** contrato del grafo de objetos de Fossil: tipos de dominio, comandos IPC y eventos (contrato #15).
**Rutas:** `crates/fossil-core/src/{ids,objects}.rs` (tipos), `apps/desktop/src-tauri/src/commands/objects.rs` (IPC), `apps/desktop/src/bindings.ts` (TS).
**Contratos públicos:** `bindings.ts` (generado, commiteado): `commands.{vaultOpen,objectCreate,...}` y `events.{objectChanged,indexUpdated}`.

## Tipos (fossil-core, specta)
`ObjectId`/`BlockId` (string Ulid, `serde(transparent)`) · `TypeKey` (Page/Journal/Builtin/Custom) · `ObjectMeta` · `NewObject` · `ObjectFilter` · `MetaPatch` · `Link`/`LinkKind` · `Mention` · `CoreError` (con `NotImplemented` para stubs).

## Comandos IPC
`vault_open(path)` · `vault_create(path,name)` · `vault_recent()` · `object_create(NewObject)` · `object_get(id)` · `object_list(ObjectFilter)` · `object_update_meta(id, MetaPatch)` · `object_archive(id)` · `object_load_doc(id) -> number[]` (estado Yjs) · `object_apply_update(id, update)` · `links_backlinks(id)` · `links_unlinked_mentions(id)` · `journal_today()`.
Todos devuelven `Result<T, CoreError>`. #17 implementa vault_* y el CRUD de metadatos;
CRDT, links y journal permanecen como stubs para sus issues. **Cambiar una firma = issue `type:contract` nuevo.**
El estado Tauri y AppHandle se inyectan solo en Rust; el contrato IPC/TS permanece intacto.

## Eventos
`object:changed { id }` (`ObjectChanged`) y `index:updated` (`IndexUpdated`); nombre exacto vía `#[tauri_specta(event_name = "...")]` (el default es kebab-case). Requieren `mount_events` en `setup` (ya cableado en `lib.rs`).

## Reglas y gotchas
- **Timestamps: Strings ISO-8601 UTC** en todo el contrato IPC/TS (specta-typescript prohíbe i64); SQLite guarda INTEGER ms y la conversión es de la capa de storage.
- specta en fossil-core lleva `features = ["derive"]` explícito y va fijado `=2.0.0-rc.25` (mismo pin que tauri-specta).
- La columna del log Yjs es `payload` (no `update`, keyword de SQLite).
- Añadir comando: macro `stub!` en `commands/objects.rs` + registro en `collect_commands!` de `lib.rs` + `cargo nextest` (regenera `bindings.ts`) + commitear el archivo.

**ADRs relacionados:** 0005 (modelo de objetos), 0004 (SQLite + espejo)

## Journal del día (#22)
`journal::today` / `for_date`: un objeto `Journal` por día local, con título ISO `YYYY-MM-DD` (la UI lo formatea). Es idempotente, restaura el del día si estaba archivado e ignora páginas con el mismo título. Al crearlo aplica la plantilla Yjs (`<paragraph></paragraph>` en `body`) en la misma transacción. El comando `journal_today` emite `object:changed` solo cuando crea.

## Captura rápida (#28)
`capture::append(conn, target, text)` agrega cada línea no vacía como `<paragraph blockId="…">` al final de `body` de la Bitácora de hoy (reemplazando el párrafo vacío de plantilla) o del objeto `target`; rechaza texto vacío o `> 20_000` caracteres. En `commands/os.rs`: `capture_append(QuickCaptureInput)` emite `object:changed` y programa espejo/índice; `capture_shortcut_get/set` y `capture_window_show/hide` son stubs (`OsError::NotImplemented` hasta `#9`); evento `CaptureRequested` (`capture:requested`).
