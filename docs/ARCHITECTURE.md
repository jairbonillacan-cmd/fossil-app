# Arquitectura de Fossil

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión; reúne el diseño del plan original con el estado medido de `main`

## Estado actual (2026-10-15, `main`)

Lo que existe hoy. Las secciones de abajo describen el diseño completo; donde el código y el
diseño difieran, manda el código y esta sección lo dice.

- **Tamaño:** ~4 200 líneas de Rust y ~1 800 de TypeScript (sin tests ni `bindings.ts`);
  58 tests de Rust y 77 de Vitest. Contados con `git ls-files` y `git grep` sobre `main`.
- **Workspace:** 7 crates en `crates/` y la app en `apps/desktop` (React + `src-tauri`), más dos
  paquetes JS (`packages/editor`, `packages/ui`).
- **Con código:** `fossil-core` (espacios, páginas, CRDT, SQLite, copia en Markdown, bitácora,
  adjuntos, búsqueda FTS5) y `fossil-ai` (contrato del router, almacén de claves, cliente SSE,
  proveedor Anthropic).
- **Esqueleto:** `fossil-bridge`, `fossil-mcp`, `fossil-data`, `fossil-os`, `fossil-proto` tienen
  solo `lib.rs`, un test y su `AGENTS.md`. Se llenan según [`MILESTONES.md`](MILESTONES.md).
- **IPC:** 23 comandos tipados (`apps/desktop/src-tauri/src/lib.rs`, `collect_commands!`).
- **Esquema:** 2 migraciones (`crates/fossil-core/migrations/`): `objects`, `object_updates`,
  `object_snapshots`, `blocks`, `links`, `tags` y el índice FTS5.
- **Aún no existe:** nube (Supabase + Hocuspocus), portal web, vistas, tipos definidos por el
  usuario, servidor MCP.

## Vista general

```
┌──────────────────────── Fossil Desktop (Tauri 2, Windows) ────────────────────────┐
│  React 19 (apps/desktop/src)                                                      │
│    shell · editor (packages/editor) · design system (packages/ui)                 │
│                │  IPC tipado: bindings.ts generado desde Rust (tauri-specta)       │
│  Rust (apps/desktop/src-tauri) ── comandos y eventos                              │
│    fossil-core   páginas · CRDT (yrs) · SQLite (FTS5) · copia en Markdown          │
│    fossil-ai     router · proveedores API/locales · claves en el almacén de Windows│
│    fossil-bridge CLIs de IA instalados, como procesos hijo                        │
│    fossil-mcp    cliente y servidor MCP (127.0.0.1 + token)                       │
│    fossil-data   conectores, modelos materializados, gráficas                     │
│    fossil-os     notificaciones, atajos globales, OCR, credenciales               │
└───────────────┬───────────────────────────────────────────────────────────────────┘
                │ WebSocket Yjs + REST (JWT)              R3 en adelante
┌───────────────▼──────────────── Fossil Cloud ─────────────────────────────────────┐
│  Hocuspocus (sync Yjs) · Supabase (auth, Postgres, storage, cron, RLS)            │
│  Worker: publicación, recordatorios, conectores, alertas, reportes                │
│  Portal web: aprobaciones, reportes compartidos, enlaces con seguimiento          │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## Reglas que sostienen el diseño

| Regla | Por qué | Dónde se hace cumplir |
|---|---|---|
| **El CRDT en SQLite es la fuente de verdad.** El `.md` es una copia | Una página editada por dos personas sin conexión se fusiona sin perder nada | ADR-0003, ADR-0004 |
| **Un solo contrato entre Rust y TypeScript**, generado | Dos agentes no pueden inventar interfaces distintas; TS no se escribe a mano | `bindings.ts` + paso de CI que falla si cambia sin commit |
| **Todo es una página.** Tareas, publicaciones y pedidos usan el mismo modelo | Cualquier cosa se enlaza y se consulta con cualquier otra | ADR-0005 |
| **Las acciones son herramientas.** La paleta, la IA y el MCP llaman lo mismo | Lo que puede hacer una persona, lo puede hacer un agente con permiso | Registro de comandos (R1), MCP (R2) |
| **Nada escucha fuera de 127.0.0.1**, y todo exige token | Una superficie local no debe ser alcanzable desde la red | `docs/DOD.md` § Seguridad |
| **Fossil nunca lee credenciales de otras apps** | Reutilizar sesiones ajenas viola sus términos y pone en riesgo la cuenta | ADR-0011 |
| **Rust de producción no hace `unwrap`/`expect`** sin justificar | Un pánico pierde trabajo | `clippy.toml` + `-D warnings` |
| **Presupuestos de rendimiento medidos en CI** | La ligereza es una función, no un deseo | `perf.yml`, [`PERFORMANCE.md`](PERFORMANCE.md) |

## Stack

| Capa | Elección | Decisión |
|---|---|---|
| Shell | Tauri 2 (Rust + WebView2), plugins single-instance, window-state, dialog; luego global-shortcut, notification, deep-link `fossil://`, updater | ADR-0001 |
| UI | React 19 + TypeScript + Vite, Tailwind v4, carga perezosa por módulo | ADR-0002 |
| IPC | tauri-specta: tipos TS generados desde Rust | `docs/modules/infra.md` |
| Editor | TipTap 3 / ProseMirror (solo extensiones MIT), bloques con ID | ADR-0015 |
| CRDT | Yjs en la UI, yrs en Rust; un documento Yjs por página | ADR-0003 |
| Local | SQLite (rusqlite, WAL) en `<espacio>/.fossil/`: updates del CRDT, tablas materializadas, FTS5; sqlite-vec en R5 | ADR-0004 |
| Nube | Supabase (auth, Postgres, storage, cron, RLS) + Hocuspocus (sync Yjs con JWT de Supabase) + worker | ADR-0006 |
| Analítica | SQLite + modelos materializados; paquete opcional con DuckDB para datasets grandes | ADR-0008 |
| Gráficas · Pizarras · PDF | Apache ECharts · Excalidraw · pdf.js | — |
| OCR · Voz | `Windows.Media.Ocr` · whisper-rs (paquete opcional) | — |
| IA | `fossil-ai` (router + proveedores) y `fossil-bridge` (CLIs locales, headless o ACP) | ADR-0011, ADR-0013 |
| MCP | rmcp, como cliente y como servidor | — |
| Pruebas | cargo-nextest, Vitest, proptest para fusiones de CRDT, WebDriver para e2e | [`TESTING.md`](TESTING.md) |

## Almacenamiento

```
<espacio>/                     carpeta elegida por la persona
  .fossil/fossil.db            SQLite (WAL): objects, object_updates, object_snapshots,
                               blocks, links, tags, índice FTS5
  .fossil/vault.json           nombre e identidad del Espacio
  .fossil/mirror.json          dónde se escribió el .md de cada página
  attachments/<ulid>.<ext>     imágenes pegadas o arrastradas; se leen solo dentro de esta carpeta
  <carpetas>/<título>.md       copia en Markdown con frontmatter YAML; sigue el árbol de páginas
                               (solo exportación hasta R7)
```

- Cada cambio del editor llega como update de Yjs (`object_apply_update`), se guarda en
  `object_updates` y se compacta en `object_snapshots`.
- Al guardar, `fossil-core::indexer` recalcula bloques, enlaces y etiquetas, y actualiza FTS5.
- 2 s después, `fossil-core::mirror` reescribe el `.md` con nombre seguro para Windows.
- Los IDs son ULID (`fossil-core::ids`): ordenables por tiempo y sin colisiones entre equipos.

## Modelo de objetos

- **Espacio:** miembros, roles y modo de cifrado (*gestionado* o *privado E2EE*, ADR-0007).
- **Página (objeto):** id, tipos, título, bloques, campos, enlaces, historial.
- **Tipo:** campos, plantilla, vista por defecto, ícono y automatizaciones. Una página puede tener varios.
- **Campos:** texto, número, moneda, fecha o rango, casilla, URL, correo, archivo; selección simple o
  múltiple, persona, estado; relación bidireccional, rollup, fórmula; campo que llena la IA.
- **Bloques** direccionables `((ref))` e insertables. Una línea con `#task` se vuelve tarea.
- **Lista guardada** (consulta viva) y **Colección** (lista manual).
- **Tipos incluidos:**
  - Conocimiento: Página, Bitácora, Persona, Reunión, Recurso, PDF, Pizarra.
  - Trabajo: Tarea, Proyecto, Objetivo.
  - Contenido y marca: Marca, Campaña, Publicación, Anuncio, Creativo.
  - Comercio (solo lectura, desde la tienda): Producto, Pedido, Cliente.
  - Datos: Dataset, KPI, Dashboard, Reporte.

## IA

```
petición (chat, acción, automatización)
   │
   ▼
router (fossil-ai) ── reglas por tarea, editables ──► cadena de respaldo
   ├─► CLI local con sesión iniciada (fossil-bridge): proceso hijo, stdin, streaming JSON por líneas
   ├─► API con clave propia: Anthropic, OpenAI, Gemini (OpenRouter, planeado)
   └─► modelo local: Ollama (LM Studio, planeado)
   │
   ▼
eventos `ai:event` (delta, uso y costo, fin, error) → UI
```

| Tarea | Ruta preferida | Respaldo |
|---|---|---|
| Chat, redacción larga, análisis, agente con herramientas | CLI local con sesión | Clave de API |
| IA inline rápida, campos IA, autocompletado | Clave de API (modelo rápido) o local | CLI local |
| Embeddings y búsqueda semántica | Local o API | — |
| Automatizaciones en la nube, reportes programados | Clave de API en la nube | — |
| Espacio con política "solo local" | Ollama o LM Studio | — |

- **El puente** ejecuta el CLI en un directorio temporal, sin acceso al Espacio salvo por MCP, con
  timeout y cancelación (mata el árbol de procesos). Si el CLI habla ACP, se usa en lugar de
  `-p` para tener sesiones y permisos. Detalle en ADR-0011 y ADR-0013.
- **Límites:** el arranque del proceso suma 1–3 s; no controla parámetros finos del modelo; cada
  persona usa su propia sesión; no funciona desde la nube.
- **Claves:** en el Administrador de credenciales de Windows (`keyring`), nunca en archivos ni logs.

## Nube (R3 en adelante)

- **Espacio gestionado:** el servidor puede leer el contenido. Es lo que permite publicar a una
  hora, el portal de aprobaciones, las alertas y los conectores.
- **Espacio privado E2EE (R7):** el servidor solo guarda bloques cifrados; esas funciones no aplican.
- **Conectores:** el worker sincroniza las APIs de la tienda y de anuncios en Postgres; la app de
  escritorio los replica en SQLite para trabajar rápido y sin conexión.
- **Respaldo:** snapshot local automático y exportación completa.

## Monorepo

```
apps/desktop/          app: src/ (React) y src-tauri/ (Rust, comandos IPC)
apps/cloud/            Hocuspocus + worker (R3)
apps/portal/           portal web de aprobaciones (R4)
crates/fossil-*        núcleo en Rust, uno por área
packages/editor        editor de bloques (TipTap + Yjs)
packages/ui            tokens de diseño, fuentes y componentes base
packages/previews      previsualizaciones por red (R4)
site/                  sitio público: changelog y roadmap
scripts/               merge gate, perf, capturas, denylist
docs/                  ver docs/README.md
```
