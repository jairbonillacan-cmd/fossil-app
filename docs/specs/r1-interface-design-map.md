# Mapa de pantallas R1.5

**Clave:** r1-ui-design · **Spec:** `docs/specs/r1-interface-design.md` (§ 1; se publica con el PR de #102 y debe entrar a `main` antes que este mapa) · **Guía visual:** `docs/DESIGN.md`

Mapa de pantallas y capturas de referencia de la interfaz actual, **antes de implementar** los
ítems r1-scrollbar, r1-page-header, r1-tabs-ui, r1-sidebar-tree y r1-images. Sirve como línea
base para comparar el antes y el después de cada ítem.

## Cómo leer este mapa

- Cada pantalla describe sus **regiones**, sus **componentes** (con su archivo) y su jerarquía
  visual; al pie, sus **capturas de referencia** en claro y oscuro.
- Lo que aún no existe se dibuja con un esquema de regiones y queda marcado **«pendiente de
  captura»**; no hay capturas de pantallas no construidas.
- Los nombres visibles son los de `docs/GLOSSARY.md`; los colores, tokens de `packages/ui`
  (paleta blanco y negro, contraste AA); tipografía Inter 14 px en UI y 16 px en el editor,
  escala de 4 px; íconos Lucide.
- **Salvedad de nombres:** la UI actual todavía dice «bóveda» (p. ej. «Crear bóveda»,
  «BÓVEDAS RECIENTES»); el nombre objetivo es **Espacio** (ADR-0017). El mapa describe lo que
  hay hoy y usa el nombre del glosario; el cambio de textos lo trae el trabajo de R1.5.

## Set de iconos de la barra lateral (para r1-sidebar-tree)

| Elemento | Ícono Lucide | Nota |
|---|---|---|
| Página | `file-text` | Tipo `Page` |
| Bitácora | `calendar-days` | Journals (título `YYYY-MM-DD`) |
| Carpeta (página con hijas) | `folder` | «Carpeta» = Página que contiene otras; nunca texto visible |
| Paleta de comandos (`Ctrl+P`, modo cambio rápido de página) | `search` | Campo arriba del árbol (la UI actual rotula «Cambio rápido de página») |

Los journals hoy muestran su `object.icon` (emoji) si existe; el set de arriba es el objetivo del
ítem y queda fijado aquí para poder contrastar la captura de referencia con la implementación.

---

## 1. Pantalla de Espacio (`vault-screen.tsx`)

Aparece al arrancar sin Espacio abierto. Jerarquía: marca arriba, acción principal (Crear bóveda)
y, debajo, la lista de recientes.

| Región | Contenido | Componente |
|---|---|---|
| Cabecera | `<AppIcon />` + `<Wordmark />` + subtítulo (`vault.subtitle`) | `vault-screen.tsx` |
| Acciones | **Crear bóveda** (primaria), **Abrir bóveda** (secundaria; diálogo nativo) | `vault-screen.tsx` |
| Recientes | Lista de Espacios recientes (comando IPC `vault_recent`; título `vault.recents`); nombre y ruta | `vault-screen.tsx` |
| Estado vacío | Sin recientes: texto `vault.recentsEmpty` | `vault-screen.tsx` |

Capturas: `103-vault-screen-light.png` · `103-vault-screen-dark.png`

## 2. Espacio de trabajo (`app.tsx`)

Layout de `docs/DESIGN.md`: barra lateral | barra de pestañas | editor / vista | panel derecho.
Hoy la barra de pestañas no existe (ver § 3) y el panel derecho vive dentro del editor.

| Región | Contenido | Componente |
|---|---|---|
| 2.1 Barra lateral | Cabecera (AppIcon + «Fossil» + nombre del Espacio), acciones (**Nueva página**, **Hoy**, **Buscar**), lista de páginas, **Ajustes** al pie | `sidebar.tsx` |
| 2.2 Barra de pestañas | *(no construida — ver § 3)* | — |
| 2.3 Encabezado de página | Título editable + acciones (**Exportar Markdown**, **Exportar PDF**, **Enlazada desde**, **IA**) | `page-editor.tsx` |
| 2.4 Editor | Cuerpo de bloques (TipTap + Yjs), contador de palabras, asa de arrastre; barra `Ctrl+F` (`PageFindBar`) | `page-body.tsx` → `@fossil/editor`; barra: `shell-search.tsx` |
| 2.5 Panel derecho | **Enlazada desde** + **Menciones sin enlace** (`w-72`) y panel **IA** (`w-80`), colapsables | `page-editor-backlinks.tsx`, `ai-panel.tsx` |

Jerarquía visual: la columna de lectura es `max-w-2xl` centrada sobre `--bg`; los paneles se
separan con `--border` y fondo `--bg-elevated`; el título es la única tipografía grande (30 px).

Capturas: `103-workspace-light.png` · `103-workspace-dark.png` (con panel **Enlazada desde** abierto)

### 2.3 Encabezado de página — detalle

Hoy el título es un `<input>` de una línea y las acciones son cuatro botones en la misma fila
(con `page-editor.tsx`). El ítem r1-page-header las agrupa en el menú `⋯` de la derecha y hace el
título siempre legible; esta captura es la referencia del «antes».

## 3. Barra de pestañas *(futura — r1-tabs-ui)* · **pendiente de captura**

Esquema de regiones previsto (una fila sobre el editor):

```text
┌────────────────────────────────────────────────────────────────────────┐
│ [[pin] Plan Acme] [Campaña Q4 ×] [Bitácora ×] … ←scroll→  [+]  [◀] [▶] │
├────────────────────────────────────────────────────────────────────────┤
│  encabezado de página (§ 2.3)                                          │
│  editor (§ 2.4)                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

| Región | Contenido | Comportamiento previsto |
|---|---|---|
| Pestañas | Título truncado + botón cerrar; fijada con ícono `[pin]` de Lucide (`docs/DESIGN.md`) | Reordenar arrastrando; desbordamiento con scroll |
| Acciones | `+` (nueva pestaña), atrás / adelante | `+` siempre visible; extremos deshabilitados |

Pendiente de captura: se captura al cerrar r1-tabs-ui.

## 4. Ajustes (`shell-settings.tsx`)

Diálogo modal con foco atrapado (Tab dentro; `Esc` o clic fuera cierran y devuelven el foco a
**Ajustes**). Jerarquía: secciones en filas de opciones, diagnóstico al pie.

| Región | Contenido |
|---|---|
| Espacio | Espacio activo (nombre; «Acme» en las capturas) |
| Apariencia | Tema (Sistema / Claro / Oscuro), densidad (Cómoda / Compacta) |
| Idioma | Español (MX) / English |
| Atajos | `Ctrl+K` **Paleta de comandos**, `Ctrl+P` **Paleta de comandos** (modo cambio rápido de página; en la UI actual aparece como «Cambio rápido de página»), `Win+Shift+F` **Captura rápida global** (referencia) |
| Diagnóstico | `<AppInfoPanel />`: versión y carpeta de datos («Datos: `%APPDATA%\Fossil`») |

Capturas: `103-settings-light.png` · `103-settings-dark.png`

## 5. Estados vacíos

| Estado | Qué se ve | Acción principal | Captura |
|---|---|---|---|
| Sin página abierta | `editor.emptyTitle` + `editor.emptyBody` en el área de contenido | **Nueva página** (en la barra lateral) | `103-empty-light.png` · `103-empty-dark.png` |
| Barra lateral sin páginas | `sidebar.empty` | **Nueva página** | (en la misma captura, Espacio vacío) |
| Recientes vacíos | `vault.recentsEmpty` | **Crear bóveda** | `103-vault-empty-recents-light.png` · `103-vault-empty-recents-dark.png` |

## 6. Estados de error

| Estado | Qué se ve | Disparador | Captura |
|---|---|---|---|
| Crear / abrir bóveda fallida | Alerta localizada `error.generic` / `error.notImplemented` (`vault-screen.tsx`) | Fallo de `vault_create`, `vault_open` o del diálogo nativo | **pendiente de captura** |
| Nueva página / Hoy fallidas | Aviso localizado en la barra lateral (`sidebar.tsx`) | Fallo de `object_create` (Nueva página) o `journal_today` (Hoy) | **pendiente de captura** |
| Carga de página fallida | Alerta localizada `error.generic` / `error.notImplemented` sobre el editor | Fallo de `object_load_doc` | **pendiente de captura** (no se fuerza un fallo sobre el Espacio de ejemplo) |
| Exportación fallida | Aviso en cabecera; no se descarga nada | Fallo de `object_export_markdown` | **pendiente de captura** |
| Imagen no cargada | Estado `error` del nodo de imagen (`editor.image.error`) | Adjunto ilegible | **pendiente de captura** (r1-images) |

Los estados de error se describen en `docs/specs/r1-interface-design.md` (§ 1) y sus capturas quedan
vinculadas a la verificación visual de los ítems de implementación de R1.5 (`r1-page-header`,
`r1-sidebar-tree`, `r1-images`), sin forzar fallos artificiales sobre el Espacio de ejemplo.

## 7. Defectos conocidos de línea base (observados en las capturas)

- **Corte en el panel derecho (`103-workspace-*`, `103-settings-*`):** el encabezado `"MENCIONES SIN ENLACE"` y el texto `"Ninguna otra página enlaz…"` se cortan en el borde derecho de la ventana sin elipsis ni salto de línea.
- **Margen respecto a Mica (`103-empty-*`, `103-workspace-*`, `103-settings-*`):** la raíz de la interfaz queda separada ~40 px a la izquierda y ~70 px arriba respecto al contenedor Mica, y al pie de la barra lateral asoma un borde de tarjeta recortado.
- **Uso de monoespaciada fuera de bloques de código:** el contador `"9 palabras · 51 caracteres"` y el valor `"Acme"` de **Espacio activo** usan `JetBrains Mono`, que `docs/DESIGN.md` reserva para código.
- **Nomenclatura pre-R1.5 y datos de muestra:** la interfaz aún muestra `"bóveda"` en lugar de **Espacio** (ADR-0017), el título de ejemplo `"Campana Acme Q4"` aparece sin `ñ`, y entre claro y oscuro varía el conteo de palabras del párrafo de muestra.

---

## Jerarquía visual (tokens)

| Nivel | Token | Uso |
|---|---|---|
| Fondo de app | `--bg` | Ventana, columna de lectura |
| Superficie elevada | `--bg-elevated` | Paneles, menús, filas activas |
| Texto | `--fg` / `--fg-muted` | Contenido / metadatos |
| Bordes | `--border` | Separación entre regiones |
| Acento | `--accent` (+ `--accent-fg`) | Acción primaria, foco, página activa |
| Semánticos | `--danger`, `--success`, `--warning` | Solo estados y datos |

## Referencias de captura

Tomadas con `scripts/capture-window.ps1` en una ventana enfocada, con datos de ejemplo (Espacio
«Acme» en `$env:PUBLIC\FossilCaptures\Acme`) y sin rutas personales. Cada pantalla se capturó
en claro y en oscuro. Método (por transparencia):

- En las capturas de **Ajustes** (`103-settings-light.png` y `103-settings-dark.png`), la ruta de
  datos del pie (`Versión 0.1.1 · Datos: %APPDATA%\Fossil`) está anonimizada con `%APPDATA%\Fossil`
  para no exponer nombres de usuario de Windows ni identificadores de cuenta.
- Las rutas de Espacios recientes en la Pantalla de Espacio usan el directorio público
  (`$env:PUBLIC\FossilCaptures\Acme`), de modo que ninguna ruta visible contiene un nombre de usuario.
- Cada captura se verificó automáticamente y con revisión visual en claro y oscuro.

| Archivo | Pantalla / estado |
|---|---|
| `103-vault-screen-{light,dark}.png` | § 1 Pantalla de Espacio |
| `103-workspace-{light,dark}.png` | § 2 Espacio de trabajo (panel derecho abierto) |
| `103-settings-{light,dark}.png` | § 4 Ajustes |
| `103-empty-{light,dark}.png` | § 5 Sin página abierta (Espacio vacío) |
| `103-vault-empty-recents-{light,dark}.png` | § 5 Recientes vacíos |
