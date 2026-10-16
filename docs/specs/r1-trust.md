# Spec R1: Confianza de datos, respaldos, historial local y espejo Markdown

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:storage`, `area:editor`, `area:ui`
> **Claves del backlog:** `r1-contract-restore` → `r1-snapshots`, `r1-page-history`, `r1-save-status`, `r1-save-chaos`, `r1-restore-ui`, `r1-mirror-roundtrip` (depende de `r1-md-import`)
> **Glosario:** Los términos nuevos (**Historial de versiones**, **Crear respaldo ahora**) se proponen al PO para inclusión formal en `docs/GLOSSARY.md` (ADR-0017) al aprobar esta spec.

## Qué y Por qué
- **Qué:** Garantías verificables de integridad para cerrar R1: snapshots consistentes del **Espacio** (SQLite + `attachments/` + configuración), restauración de una **Página**, un adjunto o el **Espacio** completo sin sobrescribir el original, historial local de versiones de **Página** sobre snapshots de Yjs (`yrs`), indicador **Guardado / Guardando / Error** acoplado al batcher de transporte y validación de ida y vuelta de la **Copia en Markdown**.
- **Por qué:** Cumple la regla de oro #1 ("nunca perder trabajo"): `Mi equipo` en `Acme` debe confiar en que ningún cierre forzado, fallo de IPC o error humano destruye información, y que cualquier **Página** o **Espacio** se recupera en segundos sin corrupción de SQLite.

## Features (divididas por capa y carril de agente)

### 1. Lógica sin UI (`crates/fossil-core`, `apps/desktop/src-tauri` y transporte TS — carril logic, agentes `zcode-a` / `zcode-b`)
- **Snapshots consistentes del Espacio (`r1-contract-restore`, `r1-snapshots`):**
  - Prohibido copiar `.fossil/fossil.db` con `std::fs::copy` en caliente. Por decisión de arquitectura (ADR-0018), el snapshot de SQLite se genera exclusivamente mediante `VACUUM INTO '<dest>/fossil.db'` sobre una conexión SQLite de solo lectura independiente (en modo WAL para no retener el cerrojo de `VaultSession` ni bloquear `object_apply_update`) y se verifica con `PRAGMA quick_check` antes de sellar el respaldo.
  - Cada snapshot se escribe en `<espacio>/.fossil/backups/<snapshot_id>/` (o ruta externa elegida) e incluye: `fossil.db` consistente, copia atómica de `.fossil/vault.json` y `.fossil/mirror.json`, los archivos referenciados de `attachments/<ulid>.<ext>` (deduplicados por nombre/SHA-256) y `manifest.json` con sumas SHA-256 de cada archivo.
  - Se dispara manualmente (`SnapshotTriggerKind::Manual`), automáticamente al abrir el **Espacio** si el último snapshot tiene > 24 h (`Scheduled`), y de forma preventiva antes de restaurar (`PreRestore`) o importar en lote (`PreImport`). Retención rotativa: últimos 10 snapshots diarios y 4 semanales.
- **Motor de restauración sin sobrescritura (`r1-snapshots`):**
  - **Espacio completo (`snapshot_restore_workspace`):** valida la ruta destino `target_dir` mediante las comprobaciones de `fs_guard` (#92): solo carpeta local absoluta (rechaza rutas UNC `\\servidor\share`, prefijos de dispositivo `\\?\` o `\\.\`, symlinks, junctions y puntos de reparseo `FILE_ATTRIBUTE_REPARSE_POINT`, y nombres de dispositivo reservados de Windows como `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`). Restaura siempre en una carpeta destino nueva (`<espacio>-restaurado-<timestamp>`) o mueve el `.fossil/` y `attachments/` actuales a una carpeta de resguardo antes de activar el snapshot verificado con `PRAGMA integrity_check`.
  - **Página individual (`snapshot_restore_page`):** lee el documento Yjs y metadatos de la **Página** dentro del snapshot; si la **Página** activa existe en el **Espacio**, guarda primero una versión `pre_restore` en su historial local o la restaura como **Página** nueva (`"<Título> (restaurada)"`) según `RestoreConflictPolicy`, sin pisar en silencio el original.
  - **Archivo adjunto (`snapshot_restore_attachment`):** valida `relative_path` estrictamente contra las entradas de `manifest.json`, rechazando cualquier segmento `..`, separadores absolutos o nombres reservados de dispositivo. Comprueba el hash SHA-256 y restaura `attachments/<ulid>.<ext>` mediante archivo temporal + `rename` solo si falta o está corrupto.
- **Historial local de páginas sobre snapshots de Yjs (`r1-page-history`):**
  - Tabla `object_versions` (separada de `object_snapshots` de compactación) que almacena snapshots completos de `yrs` (`payload BLOB`), título, extracto de texto para comparación y motivo (`trigger_kind: VersionTriggerKind`: `IdlePause`, `SignificantEdit`, `SessionClose`, `PreRestore`, `Manual`).
  - **Política de captura:** se crea una versión 1) al compactar por inactividad (30–60 s sin cambios) si transcurrieron ≥ 10 min desde la versión automática previa, 2) al acumular ≥ 200 updates o una variación > 500 caracteres respecto a la última versión, 3) al cerrar la **Página** o el **Espacio** con deltas nuevos y 4) de forma obligatoria (`PreRestore`) antes de restaurar otra versión.
  - **Política de retención:** todas las versiones de las últimas 24 h, 1 por hora en los últimos 7 días y 1 por día hasta 30 días (máximo 50 versiones automáticas por **Página**; las `Manual` y `PreRestore` se conservan sin caducar).
  - **Restauración conservando referencias:** `page_version_restore` aplica el estado de la versión elegida sobre el mismo `object_id` (tras crear el punto `pre_restore`), manteniendo válidos todos los `[[enlaces]]` entrantes desde otras páginas del **Espacio**.
- **Estado del transporte Yjs y pruebas de caos (`r1-save-chaos`):**
  - El batcher de transporte expone `SaveStatus { kind: SaveStatusKind, failed_seq: Option<u32>, last_error: Option<String> }` (con variantes `Saved`, `Saving`, `Error`) basado en el contador de deltas enviados frente a los confirmados (`ack`) por `object_apply_update`. Si un IPC falla, retiene los updates `lib0 v1` en memoria para reintento y jamás reporta `Saved`.
- **Ida y vuelta de la Copia en Markdown (`r1-mirror-roundtrip`):**
  - Suite de verificación que exporta un corpus de **Páginas** (`mirror::export_tree`) y lo reimporta en un **Espacio** limpio comprobando preservación de frontmatter YAML, encabezados, listas, tareas, citas, código, tablas, adjuntos y `[[enlaces]]`, emitiendo un `MirrorRoundtripReport` con los elementos degradados o no compatibles (`unsupported_items: Vec<MirrorUnsupportedItem>`) y documentando que hasta R7 la **Copia en Markdown** es de solo exportación (ADR-0004).

### 2. Capa de UI (`@fossil/desktop` y `@fossil/editor` — carril ui, agentes `antigravity` / `antigravity-*`)
- **Indicador Guardado / Guardando / Error en la cabecera (`r1-save-status`):**
  - Muestra en la barra de la **Página** el estado real del batcher (`Guardado`, `Guardando…`, `Error al guardar` con botón **Reintentar** y detalle del fallo). Impide cerrar la pestaña o ventana sin confirmación si existen deltas en `Saving` o `Error`.
- **Asistente de restauración y visor de historial (`r1-restore-ui`, UI de `r1-page-history`):**
  - En Ajustes del **Espacio**: lista de snapshots disponibles con fecha, tamaño y estado de verificación, botón **Crear respaldo ahora** y asistente en pasos para restaurar una **Página**, un archivo de `attachments/` o el **Espacio** completo en carpeta nueva.
  - En cada **Página**: panel lateral de **Historial de versiones** con línea de tiempo, vista de diferencias (`diff` de texto) frente a la versión actual y acciones **Restaurar esta versión** o **Restaurar como página nueva**.

## Criterios de aceptación (todos verificables con test automatizado)
- **Prueba de cierre forzado y fallo de IPC (`r1-save-chaos`):** si `object_apply_update` devuelve error simulado, el indicador permanece en `Error` con `failed_seq` y `last_error` poblados (nunca pasa a `Saved`), los deltas siguen en cola y al restablecer el canal y pulsar **Reintentar** se persisten el 100 % de los cambios; matar el proceso tras recibir `Saved` conserva el 100 % de los updates confirmados al reabrir SQLite.
- **Prueba de snapshot en caliente y base corrupta simulada (`r1-snapshots`):** crear un snapshot mientras se aplican updates concurrentes sobre SQLite en WAL produce un `fossil.db` que pasa `PRAGMA integrity_check`; si se corrompen bytes del `fossil.db` activo, el asistente detecta el fallo al abrir y restaura el último snapshot + `attachments/` + `.fossil/vault.json` en una carpeta nueva sin sobrescribir los archivos dañados originales.
- **Prueba de entradas hostiles en restauración (`r1-snapshots`):** `snapshot_restore_workspace` rechaza rutas UNC (`\\servidor\share`), prefijos de dispositivo (`\\?\C:\...`), carpetas con symlinks o junctions y nombres reservados de dispositivo (`CON`, `PRN.db`); `snapshot_restore_attachment` rechaza rutas relativas con `..` (`../archivo.png`), separadores absolutos o entradas que no figuren en `manifest.json`.
- **Prueba de historial local (`r1-page-history`):** restaurar una versión previa de una **Página** enlazada por otras 3 páginas crea automáticamente la versión `pre_restore`, recupera el contenido anterior en < 200 ms y mantiene intactos los 3 `[[enlaces]]` entrantes en `links`.
- **Prueba de ida y vuelta Markdown (`r1-mirror-roundtrip`):** exportar y reimportar el corpus de prueba conserva el 100 % del texto, estructura soportada, adjuntos y enlaces, y lista en `unsupported_items` cualquier construcción ajena sin truncar el documento.

## Fuera de alcance y Riesgos
- **Fuera de alcance:** sincronización e historial multiusuario en la nube (R3) e importación bidireccional en vivo con watcher `notify` sobre los `.md` (R7, ADR-0004).
- **Riesgos:** crecimiento de disco por snapshots y versiones (mitigado con poda rotativa automática y deduplicación de `attachments/` por hash); contención durante el respaldo (mitigado con conexión separada de solo lectura para `VACUUM INTO` bajo WAL, ADR-0018).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
```sql
-- Migración nueva en crates/fossil-core/migrations/
CREATE TABLE object_versions (
  version_id TEXT PRIMARY KEY,      -- ULID
  object_id TEXT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,       -- 'idle_pause' | 'significant_edit' | 'session_close' | 'pre_restore' | 'manual'
  payload BLOB NOT NULL,            -- snapshot yrs completo (encode_state_as_update_v1)
  plain_excerpt TEXT NOT NULL DEFAULT '',
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL       -- ms UTC
);
CREATE INDEX idx_object_versions_lookup ON object_versions (object_id, created_at DESC);

CREATE TABLE workspace_snapshots (
  snapshot_id TEXT PRIMARY KEY,     -- ULID
  snapshot_path TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,       -- 'manual' | 'scheduled' | 'pre_import' | 'pre_restore'
  object_count INTEGER NOT NULL,
  attachment_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  integrity_ok INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
```
```rust
pub enum SaveStatusKind { Saved, Saving, Error }

pub struct SaveStatus {
    pub kind: SaveStatusKind,
    pub failed_seq: Option<u32>,
    pub last_error: Option<String>,
}

pub enum SnapshotTriggerKind { Manual, Scheduled, PreImport, PreRestore }
pub enum VersionTriggerKind { IdlePause, SignificantEdit, SessionClose, PreRestore, Manual }
pub enum RestoreConflictPolicy { CreateCopy, OverwriteWithBackupVersion }

pub struct WorkspaceSnapshotMeta {
    pub snapshot_id: String,
    pub trigger_kind: SnapshotTriggerKind,
    pub object_count: u32,
    pub attachment_count: u32,
    pub total_bytes: f64,
    pub integrity_ok: bool,
    pub created_at: String, // ISO-8601 UTC
}

pub struct PageVersionSummary {
    pub version_id: String,
    pub object_id: String,
    pub title: String,
    pub trigger_kind: VersionTriggerKind,
    pub byte_size: u32,
    pub created_at: String, // ISO-8601 UTC
}

pub struct PageVersionDiff {
    pub version_id: String,
    pub old_title: String,
    pub new_title: String,
    pub old_markdown: String,
    pub new_markdown: String,
}

pub struct MirrorUnsupportedItem {
    pub path: String,
    pub reason: String,
}

pub struct MirrorRoundtripReport {
    pub total_pages: u32,
    pub preserved_pages: u32,
    pub unsupported_items: Vec<MirrorUnsupportedItem>,
}

// Comandos IPC expuestos en apps/desktop/src/bindings.ts:
// snapshot_create(trigger_kind: SnapshotTriggerKind) -> Result<WorkspaceSnapshotMeta, CoreError>
// snapshot_list() -> Result<Vec<WorkspaceSnapshotMeta>, CoreError>
// snapshot_restore_workspace(snapshot_id: String, target_dir: String) -> Result<VaultInfo, CoreError>
// snapshot_restore_page(snapshot_id: String, object_id: String, policy: RestoreConflictPolicy) -> Result<ObjectMeta, CoreError>
// snapshot_restore_attachment(snapshot_id: String, relative_path: String) -> Result<String, CoreError>
// page_version_list(object_id: String) -> Result<Vec<PageVersionSummary>, CoreError>
// page_version_diff(object_id: String, version_id: String) -> Result<PageVersionDiff, CoreError>
// page_version_restore(object_id: String, version_id: String) -> Result<ObjectMeta, CoreError>
// mirror_roundtrip_verify() -> Result<MirrorRoundtripReport, CoreError>
```
