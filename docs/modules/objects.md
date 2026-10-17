# objects
**Propósito:** contrato del grafo de objetos de Fossil: tipos de dominio, comandos IPC y eventos (contrato #15).
**Rutas:** `crates/fossil-core/src/{ids,objects}.rs` (tipos), `apps/desktop/src-tauri/src/commands/objects.rs` (IPC), `apps/desktop/src/bindings.ts` (TS).
**Contratos públicos:** `bindings.ts` (generado, commiteado): `commands.{vaultOpen,objectCreate,...}` y `events.{objectChanged,indexUpdated}`.

## Tipos (fossil-core, specta)
`ObjectId`/`BlockId` (string Ulid, `serde(transparent)`) · `TypeKey` (Page/Journal/Builtin/Custom) · `ObjectMeta` · `NewObject` · `ObjectFilter` · `MetaPatch` · `Link`/`LinkKind` · `Mention` · `RenameReport` · `BrokenLink`/`BrokenLinkReason` · `CoreError` (con `NotImplemented` para stubs).

## Comandos IPC
`vault_open(path)` · `vault_create(path,name)` · `vault_recent()` · `object_create(NewObject)` · `object_get(id)` · `object_list(ObjectFilter)` · `object_update_meta(id, MetaPatch)` · `object_archive(id)` · `object_load_doc(id) -> number[]` (estado Yjs) · `object_apply_update(id, update)` · `links_backlinks(id)` · `links_unlinked_mentions(id)` · `object_rename(id, title)` · `links_inbound_count(id)` · `links_broken()` · `journal_today()`.
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

## Renombrado seguro y enlaces (#128, `r1-safe-rename`)
Solo contrato: los tres comandos devuelven `NotImplemented`; el motor llega en #135, los avisos en #136 y el selector del editor en #137.
- **Formato de wikilink** (lo que escribe el editor y lee `indexer::parse_wikilinks`; ya funciona hoy): `[[<destino>]]`, `[[<destino>#<blockId>]]`, `[[<destino>|<alias>]]` o `[[<destino>#<blockId>|<alias>]]`. El **destino** es lo que hay antes del primer `#` o `|`, recortado; el **alias** es solo texto visible y nunca se usa para resolver.
  - **Forma con id:** el destino es el `ObjectId` (Ulid, 26 caracteres): `[[01J9Z3K7Q8M2N4P6R8T0V2X4Y6|Plan Acme]]`. Resuelve a ese objeto aunque haya títulos repetidos. **No** es `[[Título|<id>]]`: lo de después de `|` es el alias desde #19.
  - **Forma con título:** `[[Plan Acme]]` resuelve sin distinguir mayúsculas al objeto no archivado más antiguo (`created_at`, luego `id`) con ese título. Un título igual a un Ulid existente resuelve por id primero.
  - Un destino sin objeto queda en `links.to_object` como título en minúsculas; la columna `links.target_text` (migración 0005) guarda el destino tal como se escribió.
- **`object_rename(id, title) -> RenameReport { meta, updated_links, unresolved }`:** reescribe los wikilinks entrantes en el Yjs de cada página que enlaza, en una transacción (`Immediate`); si falla, no escribe nada.
  - Forma con título → `[[Nuevo título]]`, conservando alias y `#blockId`. Si el título nuevo ya lo usa otro objeto no archivado, o contiene `|` o `#`, pasa a la forma con id `[[<id>|Nuevo título]]` para no quedar ambiguo.
  - Forma con id → conserva el id; el alias cambia solo si era igual al título viejo (recortado, sin mayúsculas). Un alias propio se respeta.
  - **Archivadas:** reescribe también en páginas archivadas (restaurarlas no trae enlaces viejos) y se puede renombrar un objeto archivado. **Autoenlaces:** se reescriben y cuentan en `updated_links`. **Mismo título:** no hace nada y devuelve ceros.
  - Errores: `ObjectNotFound`, `InvalidTitle` (vacío tras recortar, más de `MAX_TITLE_CHARS` = 200 caracteres, caracteres de control o `[[`/`]]`). `object_update_meta` no cambia: sigue sin reescribir enlaces.
  - `unresolved`: entrantes que el índice atribuye al objeto pero cuyo texto ya no coincide (índice viejo, enlace partido por marcas de formato). Quedan como están y aparecen en `links_broken` cuando dejan de resolver.
  - Emite `object:changed` del objeto y de cada página reescrita y las reindexa.
- **`links_inbound_count(id) -> number`:** enlaces desde **otras** páginas (uno por bloque que enlaza), incluidas las archivadas, a diferencia de `links_backlinks`. Los autoenlaces no cuentan. Se consulta antes de archivar, mover o borrar.
- **`links_broken() -> BrokenLink[]`** con `{ from_object, from_block, target_text, reason }`: wikilinks de páginas no archivadas, autoenlaces incluidos, que no resuelven a exactamente un objeto no archivado. `reason`: `Missing` (no existe), `Archived` (solo coincide con archivados; restaurar lo arregla) o `Ambiguous` (forma con título y dos o más objetos no archivados con ese título; la forma con id nunca es ambigua). Orden: `updated_at DESC` de la página origen, luego orden de bloque.
- **Trampa para #135:** los editores abiertos no reciben hoy updates del backend; la reescritura entra como update Yjs nuevo en `object_updates` y la página abierta debe recargarse (o recibirlo) para no pisarla.
