# Mapa de pantallas R1.5

**Clave:** r1-ui-design · **Spec:** `docs/specs/r1-interface-design.md` (§ 1) · **Guía visual:** `docs/DESIGN.md`

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
| Paleta de comandos (`Ctrl+P`) | `search` | Campo arriba del árbol |

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
| Recientes | Lista de Espacios recientes (`vault_recent`); nombre y ruta | `vault-screen.tsx` |
| Estado vacío | Sin recientes: texto `vault.recentsEmpty` + foco en la acción principal | `vault-screen.tsx` |

Capturas: `103-vault-screen-light.png` · `103-vault-screen-dark.png`

## 2. Espacio de trabajo (`app.tsx`)

Layout de `docs/DESIGN.md`: barra lateral | barra de pestañas | editor / vista | panel derecho.
Hoy la barra de pestañas no existe (ver § 3) y el panel derecho vive dentro del editor.

| Región | Contenido | Componente |
|---|---|---|
| 2.1 Barra lateral | Cabecera (AppIcon + nombre del Espacio), acciones (**Nueva página**, **Hoy**, **Buscar**), lista de páginas, **Ajustes** al pie | `sidebar.tsx` |
| 2.2 Barra de pestañas | *(no construida — ver § 3)* | — |
| 2.3 Encabezado de página | Título editable + acciones (**Exportar Markdown**, **Exportar PDF**, **Enlazada desde**, **IA**) | `page-editor.tsx` |
| 2.4 Editor | Cuerpo de bloques (TipTap + Yjs), barra `Ctrl+F`, contador de palabras, asa de arrastre | `page-body.tsx` → `@fossil/editor` |
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
│ [📌 Plan Acme] [Campaña Q4 ×] [Bitácora ×] … ←scroll→   [+]  [◀] [▶] │
├────────────────────────────────────────────────────────────────────────┤
│  encabezado de página (§ 2.3)                                          │
│  editor (§ 2.4)                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

| Región | Contenido | Comportamiento previsto |
|---|---|---|
| Pestañas | Título truncado + botón cerrar; fijada con marca 📌 | Reordenar arrastrando; desbordamiento con scroll |
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
| Atajos | Ctrl+K Paleta de comandos, Ctrl+P Cambio rápido de página, Win+Shift+F Captura rápida global (referencia) |
| Diagnóstico | `<AppInfoPanel />`: versión y carpeta de datos («Datos: …») |

Capturas: `103-settings-light.png` · `103-settings-dark.png`

## 5. Estados vacíos

| Estado | Qué se ve | Acción principal | Captura |
|---|---|---|---|
| Sin página abierta | `editor.emptyTitle` + `editor.emptyBody` en el área de contenido | **Nueva página** | `103-empty-light.png` · `103-empty-dark.png` |
| Barra lateral sin páginas | `sidebar.empty` | **Nueva página** | (en la misma captura, Espacio vacío) |
| Recientes vacíos | `vault.recentsEmpty` | **Crear bóveda** | `103-vault-empty-recents-light.png` · `103-vault-empty-recents-dark.png` |

## 6. Estados de error

| Estado | Qué se ve | Disparador | Captura |
|---|---|---|---|
| Carga de página fallida | Alerta localizada `error.generic` / `error.notImplemented` sobre el editor | Fallo de `object_load_doc` | **pendiente de captura** (no se fuerza un fallo sobre el Espacio de ejemplo) |
| Exportación fallida | Aviso en cabecera; no se descarga nada | Fallo de `object_export_markdown` | **pendiente de captura** |
| Imagen no cargada | Estado `error` del nodo de imagen (`editor.image.error`) | Adjunto ilegible | **pendiente de captura** (r1-images) |

Los estados de error se describen en la spec (§ correspondiente) y se capturarán en la fase de
pruebas visuales del ítem que los implemente, sin romper el Espacio de ejemplo.

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
«Acme» en `C:\Users\Public\FossilCaptures\Acme`) y sin rutas personales. Cada pantalla se capturó
en claro y en oscuro. Método (por transparencia):

- Binario de captura construido desde esta rama con identificador
  `io.github.jairbonillacan-cmd.fossil.capture`, para no interferir con la instancia única de la
  app en ejecución; el pie de **Ajustes** muestra esa ruta de datos.
- Entorno aislado (configuración y perfil en `C:\Users\Public\FossilCaptureAppData`), de modo que
  ninguna ruta visible contiene un nombre de usuario.
- Cada captura se verificó automáticamente: huella distinta, tema correcto por nombre y texto
  reconocido (OCR) que corresponde a Fossil y no a otra ventana.

| Archivo | Pantalla / estado |
|---|---|
| `103-vault-screen-{light,dark}.png` | § 1 Pantalla de Espacio |
| `103-workspace-{light,dark}.png` | § 2 Espacio de trabajo (panel derecho abierto) |
| `103-settings-{light,dark}.png` | § 4 Ajustes |
| `103-empty-{light,dark}.png` | § 5 Sin página abierta (Espacio vacío) |
| `103-vault-empty-recents-{light,dark}.png` | § 5 Recientes vacíos |
