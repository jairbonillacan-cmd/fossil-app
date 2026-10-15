# Spec R2: Tipos, campos, colecciones y vistas

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:objects`, `area:views`, `area:storage`, `area:ui`
> **Orden de ejecución:** `contrato de datos` (`r2-contract-fields`, `r2-contract-relations`) → `trabajo` (`r2-views-core`, `r2-views-filters`, `r2-views-perf`, `r2-money`, `r2-validation`, `r2-lists-collections`, `r2-bulk`, `r2-graph`) → `agente` (`r2-contract-tools`, `r2-ai-review`). Ninguna **Vista** React se construye antes de mergear su contrato en Rust.

## Qué y Por qué
- **Qué:** Asignación de múltiples **Tipos** por **Página**, **Campos** con `field_id` estable y namespace por **Tipo**, migraciones de esquema, relaciones bidireccionales con cardinalidad e integridad, borrado lógico, rollups incrementales, una sola fuente de verdad para **Vistas** (`Tabla`, `Tablero`, `Lista`, `Calendario`), filtros `AND`/`OR`, **Listas guardadas** y **Colecciones**, decimal exacto con moneda ISO, validación declarativa y acciones masivas reversibles.
- **Por qué:** Para que `Mi equipo` en `Acme` gestione proyectos, campañas y catálogo en un mismo **Espacio** sin choques entre **Campos** homónimos de distintos **Tipos**, sin discrepancias entre **Vistas** y sin errores de redondeo en montos.

## Capa de datos y consultas (Rust / SQLite en `crates/fossil-core`, sin UI)
- **Identidad estable y namespace por Tipo (`r2-contract-fields`):** cada **Campo** tiene un `field_id` inmutable (ULID, p. ej. `fld_01j...`) y clave calificada `<type_key>.<field_slug>` (`project.status` vs. `campaign.status`). Dos **Tipos** con un campo `"status"` en la misma **Página** almacenan sus valores bajo `field_id` distintos en `object_field_values` y se exportan con prefijo de **Tipo** en el frontmatter de la **Copia en Markdown** sin colisionar.
- **Migraciones de campo (`r2-contract-fields`):** `type_migrate_field` ejecuta en transacción cambios de etiqueta/`slug`, conversión determinista de `FieldKind` (`Select -> MultiSelect`, `Number -> Text`), fusión de opciones y archivado de campo incrementando `schema_version`. Si un valor existente no puede convertirse al nuevo tipo, se preserva en `raw_fallback_json` y se marca alerta de validación sin perder datos.
- **Relaciones bidireccionales, cardinalidad y borrado lógico (`r2-contract-relations`):**
  - `object_relations` persiste aristas con `relation_field_id`, `inverse_field_id` y cardinalidad (`OneToOne`, `OneToMany`, `ManyToOne`, `ManyToMany`), validando en Rust unicidad, existencia del destino y `target_type_key`.
  - **Borrado lógico (`soft delete`):** enviar una **Página** a la papelera fija `deleted_at_utc` y marca `is_target_deleted = 1` en sus relaciones sin borrar las filas; las consultas de **Vista** y agregaciones excluyen objetos borrados lógicamente, y restaurar la **Página** reactiva sus relaciones bidireccionales sin dejar enlaces rotos.
- **Rollups incrementales, orden de evaluación de fórmulas y grafo (`r2-contract-relations`, `r2-money`, `r2-graph`):**
  - Grafo `field_dependencies` con detección de ciclos al guardar el esquema (profundidad máxima: 8 niveles) y **orden de evaluación topológico determinista** para fórmulas y rollups encadenados. Al cambiar un **Campo** o relación en `object_id`, Rust invalida y recalcula únicamente los dependientes afectados.
  - Consulta de **grafo local y global** (`graph_query` y `graph_shortest_path`) sobre `object_relations` y enlaces con filtros por **Tipo**, **Campo** o profundidad y cálculo de rutas entre **Páginas**.
- **Decimal exacto, moneda ISO y semántica de nulos (`r2-money`):** los montos y decimales nunca usan binario `f64` para cálculo; se guardan como decimal exacto en base 10 (`scaled_minor: String` con `scale: u8`, hasta 18 dígitos significativos) más código `currency_code` ISO 4217 (`MXN`, `USD`). Distingue estrictamente `null` (sin valor, ignorado en promedios/conteos o manejado con `coalesce`) de `0`, y rechaza sumar monedas distintas en un `rollup` o `formula` sin conversión explícita.
- **Validación (`r2-validation`):** reglas evaluadas en Rust antes de escribir en CRDT/SQLite: `required`, rangos (`min`, `max`), opciones válidas de `select`/`multi_select`, integridad de `relation` y transiciones permitidas del flujo de estados.
- **Motor único de consulta, filtros AND/OR y acciones masivas (`r2-views-core`, `r2-views-filters`, `r2-lists-collections`, `r2-bulk`):**
  - `view_query` resuelve en SQLite árboles `FilterGroup` (`And`/`Or`), orden multicolumna, agrupación y totales para cualquier disposición (`Table`, `Board`, `List`, `Calendar`), adjuntando en cada fila su `MatchReason` (regla que la incluye en una **Lista guardada** o pertenencia manual en una **Colección**).
  - `object_bulk_mutate` ofrece vista previa (`dry_run`), ejecución con resultado parcial (`succeeded_ids` y `failed` por validación) y lote reversible mediante `object_bulk_undo(batch_id)`.

## Capa de vistas React (`@fossil/desktop`, sin lógica de almacenamiento)
- **Fuente de verdad compartida (`r2-views-core`, `r2-graph`):** **Tabla** (columnas redimensionables, edición en celda, agregaciones), **Tablero** (agrupado por `select`/estado con arrastrar y soltar), **Lista** (compacta con hasta 4 **Campos**), **Calendario** (por **Campo** `date` o rango) y **Grafo** (local/global con filtros, rutas entre **Páginas** y acciones sobre nodos) leen del mismo estado reactivo respaldado por SQLite y se actualizan al instante tras cualquier edición.
- **Filtros, vistas guardadas y lote (`r2-views-filters`, `r2-lists-collections`, `r2-bulk`):** constructor visual de grupos `AND`/`OR`, pestañas de **Vistas** guardadas independientes (`SavedView`), insignia de `MatchReason` por elemento y barra de acciones masivas con diálogo de vista previa, reporte parcial y botón **Deshacer**.
- **Virtualización (`r2-views-perf`):** ventana virtualizada de filas y columnas de tablero para 5 000 objetos manteniendo solo los nodos visibles en el DOM.

## Criterios de aceptación, fuera de alcance y riesgos
- Dos **Tipos** con un **Campo** `"status"` en una misma **Página** mantienen valores independientes en SQLite, **Vistas** y **Copia en Markdown**; migrar el tipo de un **Campo** conserva el 100 % de los valores en `raw_fallback_json` si falla la coerción.
- **Benchmark `view_5k` con 5 000 objetos (`scripts/perf.ps1`):** mide por separado 1) **Consulta SQLite (`query_ms` < 15 ms p95)**, 2) **Serialización IPC (`serialize_ms` < 10 ms p95)** y 3) **Render virtualizado en React (`render_ms` < 25 ms p95)**, con presupuesto total < 50 ms p95.
- Cálculos en `Currency` (`MXN`, `USD`) son exactos al centavo/micra sin deriva de punto flotante; las acciones masivas previsualizan cambios, reportan éxitos/rechazos parciales y revierten el lote completo en < 2 s.
- **Fuera de alcance:** línea de tiempo y galería (R3), vistas de redes sociales (R4) y SQL libre en notas (R5). **Riesgos:** ciclos en fórmulas/rollups (bloqueados al guardar esquema + límite de 8 saltos) y huérfanos al borrar páginas (resuelto con borrado lógico `is_target_deleted`).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
```sql
CREATE TABLE type_definitions (type_key TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, default_view TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1, updated_at_utc TEXT NOT NULL);
CREATE TABLE field_definitions (field_id TEXT PRIMARY KEY, type_key TEXT NOT NULL, field_slug TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, config_json TEXT NOT NULL, validation_json TEXT NOT NULL, UNIQUE (type_key, field_slug));
CREATE TABLE object_types (object_id TEXT NOT NULL, type_key TEXT NOT NULL, deleted_at_utc TEXT, PRIMARY KEY (object_id, type_key));
CREATE TABLE object_field_values (object_id TEXT NOT NULL, field_id TEXT NOT NULL, value_json TEXT NOT NULL, raw_fallback_json TEXT, sort_text TEXT, sort_num REAL, currency_code TEXT, updated_at_utc TEXT NOT NULL, PRIMARY KEY (object_id, field_id));
CREATE TABLE object_relations (relation_id TEXT PRIMARY KEY, relation_field_id TEXT NOT NULL, inverse_field_id TEXT, cardinality TEXT NOT NULL, from_object_id TEXT NOT NULL, to_object_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, is_target_deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE field_dependencies (source_field_id TEXT NOT NULL, dependent_field_id TEXT NOT NULL, PRIMARY KEY (source_field_id, dependent_field_id));
CREATE TABLE saved_sets (set_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, filter_tree_json TEXT NOT NULL, manual_ids_json TEXT NOT NULL DEFAULT '[]', updated_at_utc TEXT NOT NULL);
CREATE TABLE saved_views (view_id TEXT PRIMARY KEY, set_id TEXT NOT NULL, name TEXT NOT NULL, layout TEXT NOT NULL, filter_override_json TEXT, sort_json TEXT NOT NULL, group_by_field_id TEXT, columns_json TEXT NOT NULL);
CREATE TABLE bulk_operation_batches (batch_id TEXT PRIMARY KEY, op_kind TEXT NOT NULL, before_snapshot_json TEXT NOT NULL, created_at_utc TEXT NOT NULL, reverted_at_utc TEXT);
```
```rust
pub enum FieldKind { Text, Number, Currency, Date, Person, Select, MultiSelect, Relation, Rollup, Formula }
pub enum RelationCardinality { OneToOne, OneToMany, ManyToOne, ManyToMany }
pub enum FilterLogic { And, Or }
pub enum ViewLayout { Table, Board, List, Calendar }
pub struct ExactDecimal { pub scaled_minor: String, pub scale: u8, pub currency_code: Option<String> }
pub struct ViewBenchmarkMetrics { pub query_ms: f64, pub serialize_ms: f64, pub render_ms: f64, pub row_count: u32 }
pub struct BulkMutationReport { pub batch_id: String, pub dry_run: bool, pub succeeded_ids: Vec<String>, pub failed: Vec<BulkItemError> }
// Comandos IPC (apps/desktop/src/bindings.ts):
// type_upsert(def: TypeDefinition) -> Result<TypeDefinition, CoreError>
// type_migrate_field(field_id: String, op: FieldMigrationOp) -> Result<FieldDefinition, CoreError>
// object_set_field(object_id: String, field_id: String, value: FieldValue) -> Result<Vec<UpdatedRollup>, CoreError>
// object_set_relation(relation_field_id: String, from_id: String, to_ids: Vec<String>) -> Result<(), CoreError>
// view_query(set_id: String, view_id: String, cursor: Option<String>, limit: u32) -> Result<ViewPageResult, CoreError>
// object_bulk_mutate(req: BulkMutationRequest, dry_run: bool) -> Result<BulkMutationReport, CoreError>
// object_bulk_undo(batch_id: String) -> Result<u32, CoreError>
```
