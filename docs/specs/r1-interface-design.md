# Spec R1.5: Diseño de la interfaz

**Clave:** s-r1-ui · **Área:** `area:ui`, `area:editor` · **Docs:** `docs/DESIGN.md`, `docs/GLOSSARY.md`, `docs/modules/ui.md`, `docs/modules/editor.md`

## Qué y por qué

La interfaz actual funciona, pero la barra de desplazamiento es la del sistema, el encabezado
amontona botones a la del título, no hay pestañas, la barra lateral es una lista plana y las
imágenes solo se insertan pegando o arrastrando. Esta spec fija cómo se ven y se comportan esos
seis frentes —en **claro y oscuro**, con la paleta blanco y negro de `docs/DESIGN.md`— antes de
escribir código, para que los ítems se implementen y revisen contra criterios medibles.

## Convenciones de los criterios

- Cada criterio usa **Dado / Cuando / Entonces** y se comprueba con un comando, un test o una
  captura; nada de valoraciones subjetivas.
- Todo criterio visual se verifica **en claro y en oscuro** (`scripts/capture-window.ps1`, ventana
  enfocada; si la captura sale plana, comparar con la barra de título antes de reportar —
  `docs/DESIGN.md` § Mica).
- Colores solo con tokens de `packages/ui` (`--bg`, `--fg`, `--accent`, …); paleta blanco y negro.
  Cero colores crudos en CSS nuevo.
- Textos visibles solo por clave i18n (`es-MX` y `en` completos); nombres de `docs/GLOSSARY.md`.
- Transiciones de 120–200 ms `ease-out`; se respeta `prefers-reduced-motion`.
- Tests con Vitest en el paquete que toque; `pnpm.cmd check` en verde.
- **«Carpeta»** es una Página que contiene otras (todo es Página, `docs/GLOSSARY.md`); se usa como
  atajo descriptivo, nunca como nombre visible en la interfaz.

## Contexto actual (verificado en `origin/main`)

- Layout: `app.tsx` (sidebar `w-64` + contenido); los paneles derecho (Enlazada desde `w-72`, IA
  `w-80`) viven dentro de `page-editor.tsx`. Estado de navegación: una sola página seleccionada.
- **No hay pestañas, ni historial atrás/adelante, ni árbol en la barra lateral** (lista plana con
  `object_list`, `parent: null`).
- El título es un `<input>` de una línea (`page-editor.tsx`); la cabecera luce cuatro botones:
  Exportar Markdown, Exportar PDF, Enlazada desde, IA.
- **No existe ningún estilo de scrollbar** en el repo; la columna de lectura (`max-w-2xl mx-auto`)
  es la que hace scroll, así que la barra queda pegada al contenido centrado.
- El nodo `image` del editor guarda solo `src` y `alt`; no hay resize, alineación ni pie de foto,
  y el menú `/` no tiene entrada de imagen.
- Tema: `data-theme` en `<html>` con `light-dark()` en `tokens.css`; densidad `data-density`.

---

## 1. r1-ui-design — Mapa de pantallas y capturas de referencia

**Entregable:** el mapa de pantallas de la interfaz R1.5 y sus capturas de referencia, antes de
implementar los ítems 2–6.

### Criterios de aceptación

- **Dado** el mapa de pantallas, **cuando** se revisa su índice, **entonces** cubre barra lateral,
  barra de pestañas, encabezado de página, editor y ajustes, y además los estados vacíos y de
  error de cada zona (una entrada por pantalla y por estado).
- **Dado** una pantalla del mapa, **cuando** se lee su descripción, **entonces** enumera sus
  regiones, sus componentes y su jerarquía visual según `docs/DESIGN.md` (Inter 14 px en UI y
  16 px en el editor, escala de 4 px, contraste AA, blanco y negro) usando tokens de `packages/ui`
  y nombres de `docs/GLOSSARY.md`.
- **Dado** la app en marcha con un Espacio de ejemplo, **cuando** se captura con
  `scripts/capture-window.ps1` en claro y en oscuro, **entonces** cada pantalla construible tiene
  su captura de referencia en `docs/screenshots/` con el patrón `<issue>-<slug>-<light|dark>.png`,
  y el mapa referencia cada captura.
- **Dado** una pantalla aún no construida (por ejemplo la barra de pestañas), **cuando** se revisa
  el mapa, **entonces** se representa con un esquema de regiones y queda marcada
  «pendiente de captura»; no se generan capturas de algo que no existe.

### Fuera de alcance

Implementación de componentes (ítems 2–6), cambios en `docs/DESIGN.md` y capturas de la fase de
pruebas visuales de cada ítem.

---

## 2. r1-scrollbar — Barra de desplazamiento discreta

**Entregable:** scrollbar casi invisible en toda la app, pegada al borde derecho de la ventana.

### Criterios de aceptación

- **Dado** cualquier zona con desplazamiento, **cuando** se ve en tema claro, **entonces** el
  pulgar es negro; y **cuando** se ve en tema oscuro, **entonces** el pulgar es blanco (deriva de
  los tokens `--scrollbar-thumb` y `--scrollbar-thumb-strong` en `tokens.css` con `light-dark()`;
  nunca un color literal).
- **Dado** la app en reposo, **cuando** no hay puntero sobre la barra ni desplazamiento activo
  (sin `[data-scrolling]` en el contenedor), **entonces** su opacidad efectiva es ≤ 0.3
  (`--scrollbar-thumb`); y **cuando** el puntero está sobre ella o hay desplazamiento activo
  (`[data-scrolling]`), **entonces** su opacidad efectiva es ≥ 0.8 (`--scrollbar-thumb-strong`),
  respetando `prefers-reduced-motion: reduce`.
- **Dado** la página con más contenido que la ventana, **cuando** se captura la ventana completa
  en claro y en oscuro, **entonces** la barra toca el borde derecho de la ventana, no el borde de
  la columna de lectura centrada (`max-w-2xl`).
- **Dado** la barra lateral, el editor y los paneles, **cuando** se desplaza cada uno,
  **entonces** todos usan el mismo estilo discreto sin romper su layout ni su área de scroll.
- **Dado** los tests de `packages/ui`, **cuando** se ejecuta `pnpm.cmd check`, **entonces** existe
  un test que afirma el token correcto en cada tema (claro: negro; oscuro: blanco) y la opacidad
  en reposo.

### Fuera de alcance

Cambios de layout, anchos de lectura y contenido centrado más allá de mover el scroll al contenedor
ancho.

---

## 3. r1-page-header — Encabezado de página

**Entregable:** título siempre legible y acciones secundarias en un menú `⋯` anclado a la derecha.

### Criterios de aceptación

- **Dado** una página cuyo título tiene 120 caracteres, **cuando** se abre en una ventana de
  1280 px de ancho en claro y en oscuro, **entonces** el título se lee completo (varias líneas o
  elipsis con tooltip que lo muestra entero) y nunca se recorta ni se solapa con el botón `⋯`.
- **Dado** el encabezado, **cuando** se mira su composición en claro y en oscuro, **entonces** las
  acciones secundarias (Exportar Markdown, Exportar PDF y las demás que existan) solo son
  accesibles desde el menú `⋯` anclado a la derecha del encabezado; fuera del menú queda
  únicamente lo esencial.
- **Dado** el botón `⋯` enfocado, **cuando** se pulsa clic, `Enter` o `Espacio`, **entonces** el
  menú se abre; y **cuando** se pulsa `Esc` o se hace clic fuera, **entonces** el menú se cierra y
  el foco vuelve al botón `⋯`.
- **Dado** el menú abierto, **cuando** se navega con el teclado, **entonces** las acciones son
  alcanzables con flechas y ejecutables con `Enter`; cada una tiene etiqueta accesible y su texto
  por clave i18n (`es-MX` y `en`).
- **Dado** los tests del shell, **cuando** se ejecuta `pnpm.cmd check`, **entonces** hay tests de
  abrir con clic/`Enter`/`Espacio`, cerrar con `Esc`/clic fuera y foco devuelto al botón.

### Fuera de alcance

Historial de versiones de la página (`r1-page-history`) y cambios de contrato IPC.

---

## 4. r1-tabs-ui — Barra de pestañas

**Entregable:** pestañas con fijar, cerrar, reordenar arrastrando, desbordamiento con scroll,
botón `+` y navegación atrás/adelante. Sin restauración de sesión.

### Criterios de aceptación

- **Dado** varias páginas abiertas, **cuando** se actúa sobre una pestaña, **entonces** se puede
  fijar y desfijar; la fijada se distingue visualmente en claro y en oscuro y solo se cierra con
  una acción explícita sobre ella (clic en su ✕, atajo de cerrar pestaña activa o menú
  contextual), nunca al cerrar las demás; y se cierra con clic o con teclado sin afectar a las
  demás.
- **Dado** tres pestañas, **cuando** se arrastra una a otra posición, **entonces** se reordena y
  la posición destino es visible durante el arrastre, en claro y en oscuro.
- **Dado** 15 pestañas abiertas en una ventana de 1280 px, **cuando** no caben, **entonces** la
  barra desborda con desplazamiento propio y el botón `+` sigue visible y operativo.
- **Dado** un historial de páginas visitadas, **cuando** se pulsa atrás o adelante, **entonces**
  la app vuelve o avanza por las páginas visitadas en orden, con los botones deshabilitados en los
  extremos.
- **Dado** cualquier interacción de pestañas, **cuando** se usa solo teclado, **entonces** todas
  las acciones son alcanzables (fijar, cerrar, reordenar, `+`, atrás/adelante) con etiquetas
  accesibles y textos por clave i18n.
- **Dado** los tests del shell, **cuando** se ejecuta `pnpm.cmd check`, **entonces** hay tests de
  reordenar, cerrar, fijar y desbordar.

### Fuera de alcance

Restauración de sesión al reiniciar (`r1-tabs-restore`) y paneles divididos (#29).

---

## 5. r1-sidebar-tree — Barra lateral en árbol

**Entregable:** árbol de páginas (las que contienen a otras funcionan como carpetas) con mover por
arrastre mediante el contrato IPC `object_move` (#118), estado expandido recordado por Espacio,
página activa resaltada y acceso a la **Paleta de comandos** (`Ctrl+P`, en modo cambio rápido de
página) arriba.

### Criterios de aceptación

- **Dado** un Espacio con carpetas y páginas, **cuando** se abre la barra lateral, **entonces** se
  ve un árbol jerárquico con el set de iconos Lucide por tipo fijado en el mapa de pantallas
  (r1-ui-design) —uno por tipo de página y otro para las carpetas—, legible en claro y en oscuro y
  mostrado en la captura de referencia.
- **Dado** una página o carpeta, **cuando** se arrastra a otra carpeta o a la raíz, **entonces** se
  mueve (reparentado) consumiendo el contrato IPC `object_move` ya entregado en **#118**
  (`objectMove(id: ObjectId, parent: string | null)`) y el destino se marca visualmente durante el
  arrastre, en claro y en oscuro.
- **Dado** un árbol expandido, **cuando** se cierra y se vuelve a abrir la app, **entonces** el
  estado expandido/contraído de cada nodo se recuerda por Espacio en `localStorage` bajo la clave
  `fossil.sidebar.expanded:<vaultName>`.
- **Dado** una página abierta, **cuando** se mira la barra lateral, **entonces** la página activa
  está resaltada de forma inequívoca en claro y en oscuro (no solo por color: también atributo
  accesible).
- **Dado** la barra lateral, **cuando** se busca una página, **entonces** el disparador de la
  **Paleta de comandos** (`Ctrl+P`, en modo cambio rápido de página; `docs/GLOSSARY.md` y
  `docs/specs/r1-shell-ux.md`) está arriba, siempre accesible —y el atajo global `Ctrl+P` sigue
  abriendo la **Paleta de comandos** en modo cambio rápido de página desde cualquier foco—, y salta
  a la página elegida.
- **Dado** los tests del shell, **cuando** se ejecuta `pnpm.cmd check`, **entonces** hay tests de
  recordar lo expandido en `localStorage` (`fossil.sidebar.expanded:<vaultName>`), resaltar la
  activa y mover con arrastre (`objectMove`).

### Fuera de alcance

Favoritos, recientes y papelera (`r1-favorites-trash`) y ranking de búsqueda (`r1-search-rank`).

---

## 6. r1-image-blocks (`r1-images`) — Imágenes en el editor

**Entregable:** insertar, redimensionar, alinear, pie de foto, `alt`, vista ampliada, carga
diferida y supervivencia al mover la página de carpeta.

### Criterios de aceptación

- **Dado** el editor, **cuando** se pega una imagen, se arrastra un archivo o se elige su entrada
  en el menú `/` (clave `editor.slash.image`), **entonces** se guarda en `attachments/` y el doc
  conserva solo la ruta relativa (`attachments/<ulid>.<ext>`), nunca bytes ni data URLs.
- **Dado** una imagen insertada, **cuando** se edita, **entonces** se puede redimensionar, alinear
  y escribir pie de foto y texto alternativo (`alt`), y el `alt` se conserva al editar y al
  reabrir la página. En la **Copia en Markdown** (ADR-0004), el archivo `.md` conserva la sintaxis
  estándar `![alt](attachments/<ulid>.<ext>)` (y el pie de foto como texto/título estándar si
  aplica), mientras que el ancho y la alineación visual viven en el documento CRDT (Yjs) en SQLite
  (fuente de verdad) sin requerir cambios en `fossil-core` en este lote.
- **Dado** una imagen cargada, **cuando** se activa (clic o `Enter`), **entonces** se abre una
  vista ampliada que se cierra con `Esc` o clic fuera.
- **Dado** una página con más de 10 imágenes, **cuando** se abre, **entonces** solo cargan las
  visibles (carga diferida) manteniendo una **latencia de entrada de teclado < 16 ms p95 con 10
  imágenes cargando**.
- **Dado** una página con imágenes, **cuando** se mueve de carpeta (vía `object_move` de #118, ya
  que los adjuntos viven por ULID en `attachments/` sin depender del padre), **entonces** las
  imágenes siguen cargando (el adjunto referenciado no se pierde).
- **Dado** los tests del editor, **cuando** se ejecuta `pnpm.cmd check`, **entonces** hay tests de
  insertar, conservar el `alt` y sobrevivir al mover la página de carpeta.

### Fuera de alcance

Duplicar página (hasta que exista un contrato `object_duplicate`), explorador de adjuntos
(`r1-attachments`), subida a la nube, edición de píxeles y cambios en el exportador Markdown de
`fossil-core`.

---

## Fuera de alcance global

Restauración de sesión, paneles divididos, duplicar página (hasta que exista un contrato
`object_duplicate`), tipografía configurable (`r1-typography`), accesibilidad general (`r1-a11y`),
contratos IPC nuevos (el reparentado del árbol en §5 y el movimiento de página en §6 consumen el
contrato IPC `object_move` —`objectMove(id: ObjectId, parent: string | null)`— ya entregado en
**#118**) y cualquier cambio nuevo en `bindings.ts` o en `fossil-core`.

## Riesgos

- **Scroll vs. layout:** mover el scroll de la columna centrada al contenedor ancho puede romper
  el anclaje de la barra Ctrl+F y del panel derecho; hay que verificarlos tras el cambio.
- **WebView2 y `::-webkit-scrollbar-thumb`:** dado que Chromium/WebView2 no interpola `transition`
  directamente sobre pseudo-elementos de scrollbar, el resaltado activo se apoya en el atributo
  `[data-scrolling]` en el contenedor y los tokens `--scrollbar-thumb` / `--scrollbar-thumb-strong`.
- **Pestañas desde cero:** no hay estado de navegación que heredar (solo `selected`); introducir
  historial atrás/adelante toca el estado compartido de `App`, y el singleton `workspaceOnSelect`
  de la barra lateral es un canal oculto fácil de romper.
- **Árbol con contrato existente (#118):** `object_list` devuelve los objetos con su `parent` y el
  reparentado por arrastre consume `object_move` (`objectMove(id: ObjectId, parent: string | null)`),
  ya fusionado en #118, sin abrir contratos nuevos.
- **Imágenes y Copia en Markdown:** `renderHTML` no emite `<img src>` y el nodo solo guarda
  `src`/`alt`; ampliar atributos (ancho, alineación, pie) toca el schema del editor y su ida y
  vuelta Yjs ↔ documento, con riesgo de perder contenido si el content model no calza (ADR-0003 /
  `docs/modules/editor.md`). El ancho y la alineación visual persisten en el CRDT Yjs en SQLite
  (fuente de verdad) mientras que la Copia en Markdown conserva `![alt](attachments/<ulid>.<ext>)`
  sin tocar `fossil-core`.
- **Rendimiento:** cada zona con scroll y cada pestaña nueva suma trabajo por frame; los
  presupuestos de `docs/DOD.md` (arranque < 1.5 s, RAM < 200 MB) siguen aplicando.
