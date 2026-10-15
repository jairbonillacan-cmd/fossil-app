# ui

**Propósito:** design system base de Fossil: tokens semánticos claro/oscuro, fuentes self-hosted, marca provisional y componentes React (`Button`, `Input`, `Wordmark`, `AppIcon`).

**Rutas:** `packages/ui` (`styles/`, `src/`, `fonts/`); se consume en `apps/desktop` (`@fossil/ui` como `workspace:*`).

**Contratos públicos:**
- `@fossil/ui` → `Button`, `Input`, `Wordmark`, `AppIcon` (TS source, se compilan con la app).
- `@fossil/ui/tokens.css`, `@fossil/ui/fonts.css`, `@fossil/ui/components.css`.
- Tokens semánticos: `--bg`, `--bg-elevated`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--danger`, `--success`, `--warning` (+ `--accent-fg`, `--font-ui`, `--font-mono`).

**Archivos clave:**
- `styles/tokens.css` — tokens semánticos con `light-dark(claro, oscuro)`; sigue el tema del SO salvo `data-theme="light|dark"` en `<html>`.
- `styles/fonts.css` + `fonts/` — Inter y JetBrains Mono variables (woff2, sin CDN) con sus OFL.
- `styles/components.css` — estilos de `.fui-button` / `.fui-input` / `.fui-wordmark` / `.fui-app-icon`: foco visible (`:focus-visible`), escala de 4 px, transiciones 150 ms ease-out, `prefers-reduced-motion`.
- `src/button.tsx`, `src/input.tsx` — wrappers delgados sobre elementos nativos (`variant`, `invalid`).
- `src/wordmark.tsx`, `src/app-icon.tsx` — marca provisional: "Fossil" en Inter Semibold y "F" en cuadrado con el acento (negro en claro, blanco en oscuro).

**Cómo probar:** `pnpm.cmd --filter @fossil/ui test` · desde la raíz: `pnpm.cmd check`

**Gotchas:**
- Cada token de color usa `light-dark()`: el valor depende del `color-scheme` usado (WebView2 evergreen lo soporta desde Chrome 123). Para fijar el tema manualmente, `data-theme` en `<html>` cambia el `color-scheme`.
- La paleta es monocromática: el acento es negro en claro y blanco en oscuro; el color solo para estados semánticos (`--danger`, `--success`, `--warning`) y gráficas.
- En tests que leen archivos, usa `import.meta.dirname`; `new URL(..., import.meta.url)` lo reescribe el transform estático de Vite y rompe bajo Vitest.
- Los componentes importan solo tokens, nunca colores crudos; clases con prefijo `fui-` (Fossil UI).

**ADRs relacionados:** —

## Shell de la app (apps/desktop, issues #26 y #31)

**Flujo de primer arranque:** `app.tsx` guarda la bóveda abierta (`VaultInfo`); sin bóveda muestra `vault-screen.tsx` (crear/abrir con diálogo nativo y recientes vía `vault_recent`, usando `<AppIcon />` y `<Wordmark />` de `@fossil/ui`). Textos en i18next (`src/i18n/`, es-MX por defecto); claves del carril shell: `vault.*`, `sidebar.*`, `editor.*`, `settings.*` y `error.*`.

**Espacio de trabajo (bóveda abierta):**
- `sidebar.tsx` — barra lateral (`object_list`), botones **Nueva página** (`object_create` con `types: ["Page"]`), **Hoy** (`journal_today`) y **Ajustes** (`ShellSettings`), con recarga automática al recibir `object:changed` e `index:updated`. Los journals con título ISO `YYYY-MM-DD` se formatean con `Intl.DateTimeFormat` (`formatObjectTitle`).
- `page-editor.tsx` — título editable con debounce de 400 ms y guardado al perder el foco (`object_update_meta`), botones **Exportar Markdown** y **Enlazada desde** (muestra/oculta el panel derecho) y `<PageBody key={object.id}>`.
- `page-editor-backlinks.tsx` — panel derecho colapsable (#28) con secciones **Enlazada desde** (`links_backlinks`) y **Menciones sin enlace** (`links_unlinked_mentions`), recarga al cambiar de página o recibir `object:changed` / `index:updated`. El botón **Enlazar** reemplaza la primera ocurrencia no enlazada (palabra completa fuera de `[[...]]`) del título actual en `Y.XmlFragment("body")` por `[[<título>]]` y persiste con `object_apply_update`.
- `page-export.ts` — `exportObjectMarkdown` (#126): pide `object_export_markdown` y descarga el `.md` tal como lo escribe el espejo (frontmatter y cuerpo). `markdownFileName` aplica las mismas reglas que `safe_name` en Rust. Si el comando falla, la página muestra un aviso y no descarga nada.
- `page-body.tsx` — el editor de bloques real (`@fossil/editor`) sobre el `Y.Doc` del objeto; errores de carga como alerta localizada (`error.notImplemented` / `error.generic`).
- `doc-transport.ts` — `createObjectTransport(id)`: `object_load_doc` al abrir y `object_apply_update` (updates lib0 v1) en cada edición.
- `shell-prefs.ts` — preferencias del shell (#31): tema `system|light|dark` en `data-theme`, densidad `comfortable|compact` en `data-density` e idioma `es-MX|en`, en `localStorage` (`fossil.theme`, `fossil.density`, `fossil.language`) con acceso protegido. `index.html` adelanta `data-theme`, `color-scheme` y `background: transparent` en `<head>`, y `main.tsx` sincroniza el resto antes del primer render (#130).
- `shell-settings.tsx` — diálogo modal de ajustes (#31): bóveda activa, tema, densidad e idioma (vía `shell-prefs.ts`), referencia de atajos y diagnóstico `<AppInfoPanel />`. Modal accesible: el foco entra al abrir, Tab queda dentro, Escape o clic fuera cierran y el foco vuelve al botón **Ajustes**. La exportación a Markdown vive en la cabecera de la página (`page-export.ts`).
- `shell-commands.ts` — registro tipado de comandos `registerCommand({ id, title, shortcut, run })` y matcher difuso `fuzzyMatch(query, target)` con puntuación e índices de resaltado (#27).
- `shell-palette.tsx` — paleta modal (#27): `Ctrl+K` busca comandos registrados y objetos (`search_query` con fallback a `object_list` si devuelve `NotImplemented`); `Ctrl+P` abre el quick switcher difuso por título, con navegación `ArrowUp`/`ArrowDown`/`Enter`/`Escape` y foco restaurado al cerrar.
- `shell-search.tsx` — pantalla de búsqueda global (#29) con debounce de 80 ms, filtros por tipo (`Page`/`Journal`), tag y rango de fechas (UTC ISO-8601), resultados agrupados por tipo con snippets resaltados (`SnippetPart[]` → `<mark>`), y barra `Ctrl+F` (`PageFindBar`) de búsqueda en página con CSS Custom Highlight API.

**Gotchas:**
- **Arranque sin destello blanco (#130):** `tauri.conf.json` declara `"backgroundColor": [0, 0, 0, 0]` junto a `"transparent": true` en la ventana `main` para que WebView2 use alfa 0 (`DefaultBackgroundColor`) antes de la primera navegación, e `index.html` fija `background: transparent` y `data-theme` en `<head>` antes de cargar `/src/main.tsx`.
- El picker nativo requiere `@tauri-apps/plugin-dialog` (JS) + `tauri-plugin-dialog` (Rust) y el permiso `dialog:allow-open` en `capabilities/default.json`; sin él, `open()` falla.
- Errores de acción de usuario → `error.notImplemented` / `error.generic` en pantalla (`CoreError::Storage` se extrae de `{ Storage: string }`); cargas de fondo fallidas → estado vacío en silencio.
- **Cuerpo de página:** `PageBody` va con `key={object.id}` (cambiar de página remonta y limpia la alerta) y crea su `Y.Doc` en un efecto que lo destruye al limpiar (seguro con StrictMode). El transporte debe estar memoizado por objeto: si cambia, el editor recarga el cuerpo.
- Una bóveda nueva toma su nombre del basename de la carpeta elegida (`vaultNameFromPath`).
- El título de un journal se guarda en SQLite como `YYYY-MM-DD`; `page-editor.tsx` lo muestra formateado sin sobrescribir `title` salvo que el usuario lo edite.

