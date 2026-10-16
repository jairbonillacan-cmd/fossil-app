# Spec R1 / R1.5: Importación de Markdown, Bandeja universal y primer inicio

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:storage`, `area:os`, `area:ui`
> **Claves del backlog:** `r1-contract-restore` (prerrequisito) → `r1-contract-import` → `r1-md-import`, `r1-import-conflicts`, `r1-capture-inbox`, `r1-onboarding`
> **Glosario:** Los términos nuevos (**Bandeja universal**, **Espacio de ejemplo**) se proponen al PO para inclusión formal en `docs/GLOSSARY.md` (ADR-0017) al aprobar esta spec.

## Qué y Por qué
- **Qué:** Importador de carpetas Markdown con análisis previo (`dry-run`), preservación de frontmatter YAML, imágenes y `[[enlaces]]`, vista de conflictos y reversión completa del lote; **Bandeja universal** como destino de captura rápida (texto, enlace o archivo adjunto) incluso con la ventana principal cerrada; y experiencia de primer inicio en tres pasos con **Espacio** de ejemplo eliminable.
- **Por qué:** Para que `Mi equipo` en `Acme` adopte Fossil trayendo sus notas existentes en Markdown sin temor a ensuciar el **Espacio** (todo lote se previsualiza y se puede deshacer), capture ideas o archivos al vuelo hacia un buzón único y entienda el producto desde el primer minuto.

## Features (divididas por capa y carril de agente)

### 1. Lógica sin UI (`crates/fossil-core` y `apps/desktop/src-tauri` — carril logic, agentes `zcode-a` / `zcode-b`)
- **Importador de carpetas Markdown en dos pasadas (`r1-contract-import`, `r1-md-import`):**
  - **Pasada 1 (Escaneo y vista previa `import_preview_folder`):** aplica las validaciones estrictas de `fs_guard` (#92): solo carpetas locales absolutas (rechaza rutas UNC `\\servidor\share` y prefijos de dispositivo `\\?\` o `\\.\`), rechazo de symlinks, junctions y puntos de reparseo (`FILE_ATTRIBUTE_REPARSE_POINT`), y rechazo de nombres reservados de dispositivo de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, con o sin extensión como `CON.md`). Aplica topes de seguridad: límite de 20 MB por archivo `.md` (igual al tope de adjuntos), profundidad máxima de 10 niveles de subcarpetas y un máximo de 5 000 archivos en el lote. Parsea el frontmatter YAML (`title`, `tags`, fechas e identifica claves personalizadas), mapea subcarpetas a la jerarquía `parent_id`, localiza imágenes referenciadas (`![alt](ruta)` y sintaxis wiki de adjunto) y construye la tabla de símbolos de títulos y rutas relativas sin escribir en SQLite.
  - **Detección de conflictos y advertencias:** clasifica cada hallazgo como `DuplicateTitle` (título ya existente en el **Espacio** o repetido en la carpeta), `MissingAttachment` (imagen referenciada que no existe en disco), `OversizedAttachment` (> 20 MB o formato no admitido), `UnresolvedLink` (`[[enlace]]` sin destino), `InvalidPath`, `HostilePath` o `InvalidFrontmatter`.
  - **Pasada 2 (Ejecución transaccional `import_execute_folder`):** valida nuevamente las rutas con `fs_guard`, dispara primero un snapshot automático preventivo (`SnapshotTriggerKind::PreImport` de `r1-trust.md`), asigna un `batch_id` (ULID), copia los adjuntos válidos de forma atómica a `attachments/<ulid>.<ext>`, convierte el cuerpo Markdown al árbol Yjs (`yrs`) resolviendo los `[[enlaces]]` internos hacia el `object_id` real de cada **Página** importada, indexa en `blocks`/`links`/`tags`/`fts_objects` y registra cada elemento creado en `import_batch_items`.
- **Reversión total de una importación (`r1-md-import`, `r1-import-conflicts`):**
  - `import_revert_batch(batch_id)` consulta `import_batch_items`: elimina en una transacción todas las **Páginas** del lote que no hayan sido editadas por el usuario tras la importación (las editadas se conservan o archivan según indique el parámetro `force_edited`), borra sus archivos `.md` de la **Copia en Markdown** y elimina de `attachments/` únicamente los archivos creados por ese lote que no estén referenciados por ninguna otra **Página**.
- **Backend de Bandeja universal para captura rápida (`r1-capture-inbox`):**
  - Extiende la captura rápida en `fossil-core` y `commands/os.rs` para soportar el destino **Bandeja universal** (una **Página** especial del sistema con rol `inbox`, creada bajo demanda si no existe, además de la **Bitácora** de hoy o una **Página** específica).
  - El rol de sistema se persiste en la tabla `objects` mediante la columna `system_role TEXT CHECK (system_role IN ('inbox'))` con un índice único condicional `idx_objects_system_role_inbox ON objects(system_role) WHERE system_role = 'inbox'`, garantizando exactamente una Bandeja universal por **Espacio**.
  - Soporta tres tipos de entrada (`CapturePayloadKind`): `Text` (bloque de párrafo o tarea), `Link` (URL con etiqueta opcional) y `Attachment` (valida bytes mágicos y límite de 20 MB, guarda en `attachments/<ulid>.<ext>` e inserta el bloque de referencia en el CRDT de la **Bandeja universal**).
  - Funciona en segundo plano desde la bandeja del sistema de Windows aunque la ventana principal esté cerrada (`VaultSession` escribe directo sobre SQLite + `yrs` y programa la **Copia en Markdown**), devuelve `CaptureSavedReceipt { target_object_id, target_title, block_id, attachment_path }` y expone el código `OsError::ShortcutConflict` cuando Windows u otro proceso ya retiene el atajo global.
- **Semilla del Espacio de ejemplo (`r1-onboarding`):**
  - Generador en Rust (`workspace_seed_sample`) que puebla un **Espacio** recién creado con 4 **Páginas** de ejemplo neutras de `Acme` y `Mi equipo` (guía de inicio, proyecto de muestra con `[[enlaces]]` y tareas, nota en la **Bitácora** y un adjunto de ejemplo), marcándolas en `import_batch_items` bajo el lote reservado `'sample_onboarding'` para permitir su borrado total en un clic (`workspace_clear_sample`).

### 2. Capa de UI (`@fossil/desktop` — carril ui, agentes `antigravity` / `antigravity-*`)
- **Asistente de importación, vista de conflictos y deshacer (`r1-import-conflicts`):**
  - Modal accesible desde Ajustes, la **Paleta de comandos** (`Ctrl+K`) y el primer inicio: muestra el resumen de `ImportPreviewReport` (páginas, carpetas, imágenes y tabla filtrable de conflictos con opción de renombrar duplicados u omitir archivos con error), barra de progreso durante la importación y botón **Deshacer importación completa** en el resumen final y en Ajustes.
- **Ventana de captura rápida y feedback de guardado (`r1-capture-inbox`):**
  - Selector de destino (**Bandeja universal** por defecto, **Bitácora** de hoy o **Página** reciente), soporte para pegar texto, URL o archivo/imagen desde el portapapeles, notificación/banner de confirmación indicando exactamente en qué **Página** se guardó con enlace para abrirla, y aviso claro en Ajustes/captura si Windows retiene el atajo global con botón directo para elegir otra combinación.
- **Primer inicio en tres pasos (`r1-onboarding`):**
  - Pantalla de bienvenida en 3 pasos: 1) elegir carpeta del **Espacio** (o importar carpeta Markdown), 2) elegir idioma (`es-MX` / `en`) y tema (`Claro` / `Oscuro`), y 3) abrir vacío o con el **Espacio de ejemplo** de `Acme` (mostrando un banner discreto **Eliminar páginas de ejemplo** que invoca `workspace_clear_sample`).

## Criterios de aceptación (todos verificables con test automatizado)
- **Corpus de 1 000 archivos (`r1-md-import`):** importar una carpeta de prueba con 1 000 archivos `.md`, subcarpetas, frontmatter YAML, 100 imágenes y 3 000 `[[enlaces]]` cruzados completa en < 10 s, resuelve los enlaces entre páginas en `links`, copia las imágenes a `attachments/` y mantiene la búsqueda `search_10k` en < 50 ms.
- **Prueba de entradas hostiles en importación (`r1-md-import`):** `import_preview_folder` e `import_execute_folder` rechazan con error tipado: 1) rutas UNC (`\\servidor\share`), 2) carpetas con symlinks o junctions, 3) nombres de dispositivo (`CON.md`), 4) archivos `.md` > 20 MB, 5) profundidad de subcarpetas > 10 niveles y 6) lotes > 5 000 archivos, abortando antes de tocar SQLite o disco.
- **Conflictos y reversión total (`r1-import-conflicts`):** ante títulos duplicados, rutas inválidas o imágenes faltantes, `import_preview_folder` los reporta todos antes de escribir un solo byte; tras ejecutar `import_execute_folder` y luego `import_revert_batch`, el **Espacio**, `.fossil/mirror.json` y `attachments/` regresan exactamente al conteo previo (0 huérfanos).
- **Bandeja universal en segundo plano (`r1-capture-inbox`):** con la ventana principal cerrada (app en bandeja del sistema), enviar texto, enlace o archivo mediante captura rápida lo persiste en la **Bandeja universal**, devuelve el recibo `CaptureSavedReceipt` con `target_object_id`, `target_title`, `block_id` y `attachment_path`, y si un atajo está ocupado en Windows, devuelve `ShortcutConflict` mostrando el aviso con opción de cambio en vez de fallar en silencio.
- **Espacio de ejemplo (`r1-onboarding`):** crear un **Espacio** con contenido de ejemplo, editar una de sus páginas o crear una nueva y pulsar **Eliminar páginas de ejemplo** borra todas las páginas de muestra intactas y conserva el 100 % del trabajo del usuario.

## Fuera de alcance y Riesgos
- **Fuera de alcance:** importadores de HTML/CSV o bases estructuradas externas (planeados en R2 `r2-import-full`) y sincronización continua bidireccional de carpetas externas (R7).
- **Riesgos:** archivos Markdown con codificación no UTF-8 o frontmatter malformado (se importan como texto plano registrando la advertencia en `ImportConflictItem` sin abortar el lote).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
```sql
-- Extensión a la tabla objects para soporte de rol de sistema (ADR-0005)
ALTER TABLE objects ADD COLUMN system_role TEXT CHECK (system_role IN ('inbox'));
CREATE UNIQUE INDEX idx_objects_system_role_inbox ON objects(system_role) WHERE system_role = 'inbox';

CREATE TABLE import_batches (
  batch_id TEXT PRIMARY KEY,        -- ULID o 'sample_onboarding'
  source_folder TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  attachment_count INTEGER NOT NULL,
  warning_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,      -- ms UTC
  reverted_at INTEGER
);

CREATE TABLE import_batch_items (
  batch_id TEXT NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL,          -- 'object' | 'attachment'
  item_id TEXT NOT NULL,            -- object_id o ruta 'attachments/<ulid>.<ext>'
  initial_updated_at INTEGER NOT NULL,
  PRIMARY KEY (batch_id, item_kind, item_id)
);
```
```rust
pub enum ImportConflictKind {
    DuplicateTitle,
    MissingAttachment,
    OversizedAttachment,
    UnresolvedLink,
    InvalidPath,
    HostilePath,
    InvalidFrontmatter,
}
pub enum DuplicateResolution { SuffixWithFolder, SuffixWithNumber, Skip }
pub enum CaptureTargetKind { UniversalInbox, TodayJournal, SpecificPage }
pub enum CapturePayloadKind { Text, Link, Attachment }

pub struct ImportConflictItem {
    pub relative_path: String,
    pub kind: ImportConflictKind,
    pub detail: String,
}

pub struct ImportPreviewReport {
    pub source_folder: String,
    pub total_markdown_files: u32,
    pub total_attachments: u32,
    pub resolved_links: u32,
    pub conflicts: Vec<ImportConflictItem>,
}

pub struct ImportBatchResult {
    pub batch_id: String,
    pub created_pages: u32,
    pub copied_attachments: u32,
    pub warnings: Vec<ImportConflictItem>,
}

pub struct CaptureSavedReceipt {
    pub target_object_id: String,
    pub target_title: String,
    pub block_id: String,
    pub attachment_path: Option<String>,
}

// Comandos IPC expuestos en apps/desktop/src/bindings.ts:
// import_preview_folder(source_dir: String) -> Result<ImportPreviewReport, CoreError>
// import_execute_folder(source_dir: String, duplicate_policy: DuplicateResolution) -> Result<ImportBatchResult, CoreError>
// import_revert_batch(batch_id: String, force_edited: bool) -> Result<u32, CoreError>
// workspace_seed_sample() -> Result<ImportBatchResult, CoreError>
// workspace_clear_sample() -> Result<u32, CoreError>
```
