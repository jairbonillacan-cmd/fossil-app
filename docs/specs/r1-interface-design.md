# Spec R1.5: Diseño de la interfaz

**Área:** `area:ui`, `area:editor` · **Docs:** `docs/DESIGN.md`, `docs/GLOSSARY.md` · **Backlog:** filas `s-r1-ui`…`r1-images` de `docs/backlog/R1-R2-recomendaciones.md`

## Objetivo
Definir el diseño de la interfaz del Espacio para R1.5: barra lateral en árbol, barra de pestañas, encabezado de página con menú `⋯`, barra de desplazamiento discreta, imágenes en el editor, y los estados vacíos y de error de todo lo anterior. Todo en claro y oscuro con la paleta monocromática de `docs/DESIGN.md` y criterios de aceptación medibles.

## Principios (heredados de `docs/DESIGN.md`)
- Paleta blanco y negro: acento negro en claro, blanco en oscuro; el color solo para `--danger`, `--success`, `--warning` y gráficas.
- Solo tokens semánticos de `@fossil/ui` (`--bg`, `--bg-elevated`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--accent-fg`, `--danger`, `--success`, `--warning`); ningún color crudo en componentes.
- Escala de espaciado de 4 px; transiciones de 120–200 ms `ease-out`; se respeta `prefers-reduced-motion`.
- Todo usable con teclado con foco visible (`:focus-visible`); íconos Lucide monocromos.
- Nombres de la interfaz según `docs/GLOSSARY.md` (Espacio, Página). Textos solo vía i18n (`es-MX` por defecto, `en` completo).
- Ningún estado vacío sin explicación y acción principal.

## Estado actual medido (octubre 2026)
- `app.tsx` renderiza `<Sidebar>` + `<PageEditor>`; no hay barra de pestañas ni panel derecho integrado.
- `sidebar.tsx` lista objetos en plano (`<ul>` con `content-visibility`), resalta la activa con `aria-current="true"` + `--accent`; sin arrastre, sin árbol.
- `page-editor.tsx` pone el título (`<input>` `flex-1 min-w-0`) y 4 botones en línea (Markdown, PDF, Enlazada desde, IA); un título largo encoge el input pero no hay elipsis ni menú.
- No existe ningún estilo de scrollbar en el repo; `tokens.css` no define tokens de scrollbar.
- El quick switcher `Ctrl+P` vive en `shell-palette.tsx` (modo `switcher`), montado desde el sidebar.
- `ImageAttachment` solo guarda `src` y `alt`; no hay ancho, alineación, pie ni vista ampliada.
- No hay primitiva de menú desplegable (solo el menú `/` del editor, patrón `listbox`).

---

## 1. Barra de desplazamiento (`r1-scrollbar`, #111)

### Decisiones
- El scroll de la página vive en la columna derecha del shell (la que contiene las pestañas y el editor), que toca el **borde derecho de la ventana**: la scrollbar siempre queda pegada al borde de la ventana, aunque el contenido del editor esté centrado con ancho de lectura.
- Estilos globales en `apps/desktop/src/styles.css` con `::-webkit-scrollbar` (WebView2 evergreen) y `scrollbar-width: thin` como declaración base.
- Tokens nuevos en `packages/ui/src/styles/tokens.css`, definidos con `color-mix` sobre `--fg` (negro en claro, blanco en oscuro):
  - `--scrollbar-thumb`: `color-mix(in srgb, var(--fg) 18%, transparent)` — reposo, casi invisible.
  - `--scrollbar-thumb-hover`: `color-mix(in srgb, var(--fg) 38%, transparent)`.
  - `--scrollbar-thumb-active`: `color-mix(in srgb, var(--fg) 55%, transparent)` — mientras se desplaza.
  - `--scrollbar-track`: `transparent`.
- Geometría: ancho 10 px, pulso con radio completo y margen vertical de 2 px; `scrollbar-gutter: stable` en el contenedor de scroll para que el contenido no salte al aparecer.

### Criterios de aceptación (medibles)
1. En reposo el pulso no supera el 20 % de opacidad del `--fg` del tema (18 % según token) — casi invisible en ambos temas.
2. Al pasar el cursor sobre la scrollbar el pulso sube a ≥ 35 %; mientras se arrastra o desplaza, ≥ 50 %.
3. El borde derecho del pulso queda a ≤ 2 px del borde interior de la ventana (el contenedor de scroll llega al borde).
4. La pista es transparente: no se dibuja fondo ni borde sobre Mica.
5. Test de estilo: `tokens.css` define los tres tokens con `color-mix(... var(--fg) ...)` y `styles.css` los consume en `::-webkit-scrollbar` (test que lee los archivos, con `import.meta.dirname`).
6. Capturas en claro y oscuro donde la scrollbar apenas se note y toque el borde derecho.

## 2. Encabezado de página (`r1-page-header`, #112)

### Decisiones
- Una sola fila de encabezado: título a la izquierda, acciones a la derecha, `gap` de 8 px, alineación al inicio.
- **Título:** `<input>` de una línea con `min-w-0`; cuando no tiene foco y desborda, muestra elipsis (`text-overflow: ellipsis`) y `title` con el texto completo (tooltip nativo). Al enfocar se comporta como hoy (scroll horizontal del texto). El guardado con debounce de 400 ms no cambia.
- **Acciones de panel visibles:** los botones de alternar **Enlazada desde** e **IA** quedan como botones de ícono con `aria-expanded` y tooltip (son estado visible del layout).
- **Menú `⋯` de documento:** botón de ícono (Lucide `MoreHorizontal`) con `aria-label` de i18n, `aria-haspopup="menu"` y `aria-expanded`, anclado a la derecha del encabezado. Contenido (`role="menu"`, `role="menuitem"`):
  - **Exportar Markdown** (comportamiento actual de `page-export.ts`).
  - **Exportar PDF** (comportamiento actual de `printObjectPdf`).
  - **Copiar enlace**: copia `[[Título]]` al portapapeles (wikilink reutilizable en cualquier página; sanea `[`, `]`, `|`, `#` como ya hace `replaceFirstUnlinkedMentionInDoc`). Aviso de confirmación con el patrón de avisos local existente.
- **Teclado del menú:** abre con `Enter`/`Espacio`/`ArrowDown` (foco al primer ítem); `ArrowUp`/`ArrowDown` navegan, `Home`/`End` saltan; `Esc` o `Tab` cierran y devuelven el foco al botón `⋯`; clic fuera cierra. Los ítems se deshabilitan (no se ocultan) si su acción no aplica.
- El historial de versiones **no** entra (llega con el trabajo de confianza de R1.5); la spec lo lista como extensión futura del menú.

### Criterios de aceptación (medibles)
1. Con un título de ~120 caracteres y la ventana a 800 px de ancho: el título se ve con elipsis y tooltip completo; ningún botón se solapa ni se recorta; a 1920 px el título cabe completo o con elipsis, nunca bajo los botones.
2. El menú `⋯` abre con ratón y con teclado; `Esc` lo cierra y el foco vuelve al botón (test).
3. Los ítems Exportar Markdown/PDF conservan el comportamiento actual (tests existentes de `page-editor.test.tsx` en verde) y «Copiar enlace» pone `[[Título]]` en el portapapeles (test).
4. El botón `⋯` tiene `aria-label`, `aria-haspopup="menu"`, `aria-expanded` y es alcanzable por `Tab` antes que el menú.
5. Todos los textos del menú y avisos existen en `es-MX.json` y `en.json` (namespace `editor.*`), y el test de cadenas hardcodeadas pasa.

## 3. Barra de pestañas (`r1-tabs-ui`, #29)

### Decisiones
- Franja de pestañas arriba de la columna derecha (entre el borde superior de la ventana y el encabezado de página); altura 40 px en densidad cómoda, 36 px en compacta.
- Cada pestaña: ícono del tipo (Lucide), título con elipsis a una línea, indicador de *pin* (Lucide `Pin`) y botón cerrar (`X`, visible al pasar el cursor o si está activa). Ancho 120–200 px.
- **Fijar:** menú contextual de la pestaña (clic secundario) con *Fijar/Desfijar* y *Cerrar*; una pestaña fijada no la cierra `Ctrl+W` ni el botón cerrar de la app (solo se desfija o cierra explícitamente).
- **Cerrar:** botón `X`; `Ctrl+W` cierra la activa (salvo fijada); `Ctrl+Tab`/`Ctrl+Shift+Tab` alternan; al cerrar la activa se activa la vecina (derecha, si no hay, izquierda).
- **Reordenar:** arrastre con Pointer Events (no HTML5 DnD, para no chocar con el arrastre de archivos del editor) reordenando en vivo; `ArrowLeft`/`ArrowRight` con la pestaña enfocada también reordenan en modo de movimiento (`Alt` presionado no requerido: basta el foco en la pestaña y `Ctrl+Shift+Arrow`).
- **Desbordamiento:** la franja hace scroll horizontal propio (rueda y arrastre); bordes con degradado del `--bg` cuando hay más contenido; al activar una pestaña oculta, la franja hace scroll hasta hacerla visible.
- **Botón `+`:** al final de la franja; abre la pantalla de inicio del Espacio (estado sin página seleccionada) en pestaña nueva.
- **Atrás/adelante:** par de botones de ícono (`ArrowLeft`/`ArrowRight`) al inicio de la franja, con historial de navegación **por pestaña** (pila de ids visitados); deshabilitados en los extremos; tooltips con i18n.
- Sin restauración de sesión: al cerrar la app se pierden las pestañas (`r1-tabs-restore`, issue propio).
- Estado en React (`useState` en el shell), sin IPC ni `bindings.ts`.

### Criterios de aceptación (medibles)
1. Con 15 pestañas abiertas la franja desborda con scroll, sin saltos de layout y sin que la pestaña activa desaparezca de vista.
2. Arrastrar una pestaña de la posición 1 a la 3 reordena en ≤ 2 movimientos de pointer y el orden persiste en la sesión.
3. `Ctrl+W` respeta fijadas (test); `Ctrl+Tab` recorre en orden visual (test).
4. Atrás/adelante navegan el historial de la pestaña activa y se deshabilitan en los extremos (test).
5. Todo control es alcanzable con `Tab` y opera con teclado; textos en i18n (namespace nuevo `tabs.*`).

## 4. Barra lateral en árbol (`r1-sidebar-tree`, #113)

### Decisiones
- **Jerarquía sin contrato nuevo:** una «carpeta» es una Página con hijas (`parent` del contrato ya existe en `NewObject`, `ObjectMeta` y `ObjectFilter`). Coherente con la regla «todo es una página»: cualquier página puede contener subpáginas; el ícono de carpeta (Lucide `Folder`/`FolderOpen`) aparece cuando tiene hijas expandidas o contraídas.
- Render en `sidebar.tsx`: árbol a partir de `objectList({ include_archived: false, … })` agrupado por `parent` en el cliente (los journals quedan fuera del árbol, como hoy).
- **Nueva subpágina:** acción en el menú contextual / botón de fila de carpeta; `object_create` con `parent` asignado.
- **Arrastrar para mover:** Pointer Events sobre filas; soltar sobre una carpeta la convierte en `parent`; soltar «entre» filas reordena visualmente si el orden existe, si no, solo mueve al padre (sin contrato de orden manual en R1.5). El espejo Markdown refleja el movimiento al reescribirse.
- **Expandir/contraer recordado:** `localStorage` con clave `fossil.tree.expanded.<vaultId>` (set de ids); se restaura al montar.
- **Página activa:** `aria-current="true"` + acento (patrón actual de `sidebar.tsx:168`).
- **Búsqueda arriba:** fila superior del sidebar con el afordance de quick switcher (botón con aspecto de campo que dice «Saltar a…» y muestra `Ctrl+P`); abre el `switcher` existente. El botón **Buscar** global y **Hoy** quedan como hoy.
- Rendimiento: se conserva `content-visibility` por fila; con > 200 objetos visibles se mide y, si el scroll baja de 60 fps, se virtualiza (regla de `docs/DESIGN.md`).

### Criterios de aceptación (medibles)
1. Crear una subpágina bajo una carpeta la anida; moverla por arrastre cambia su `parent` (verificado con `object_get`, test).
2. Expandir dos carpetas, cerrar la app y reabrir las deja expandidas (localStorage; test con storage simulado).
3. La página activa muestra `aria-current="true"` y el borde/acento del tema (test de render).
4. El afordance «Saltar a…» abre el quick switcher con `Ctrl+P` y con clic.
5. Sin cambios en `bindings.ts`; si la implementación descubre lo contrario, issue `type:contract` y este ítem a `status:blocked`.

## 5. Imágenes en el editor (`r1-images`, #114, bloqueado por #82)

### Decisiones
- Inserción: portapapeles, arrastre de archivo y entrada **Imagen** del menú `/` (ya existe la base en `image-attachment.ts` con `saveAttachment` y ruta relativa `attachments/<nombre>.<ext>`).
- Atributos nuevos del nodo `image`: `width` (25 | 50 | 75 | 100, porcentaje del ancho de lectura), `align` (`left` | `center`), `caption` (texto del pie), más los existentes `src` y `alt`. En Yjs solo atributos; el pie viaja en el espejo Markdown como línea de cursiva debajo (convención ya usada para pies).
- **Texto alternativo:** al insertar, el `alt` toma el nombre de archivo sin extensión; se edita desde un botón de la propia imagen (formulario inline) y se conserva en ida y vuelta Yjs ↔ Markdown.
- **Redimensionar:** manija inferior o menú contextual de la imagen con los 4 anchos; el ancho se aplica como `width: <n>%` con `height: auto`.
- **Vista ampliada:** clic abre *lightbox* (overlay con `--bg-elevated`, cierra con `Esc` y clic fuera, foco devuelto a la imagen).
- **Carga diferida:** `loading="lazy"` y `decoding="async"`; se reservan las dimensiones naturales guardadas al insertar (`width`/`height` internos) para no saltar el layout.
- **Movimiento y duplicado:** las rutas son relativas a la raíz de adjuntos del Espacio, así que mover o duplicar la página no las rompe (test de ida y vuelta).
- Bloqueado por #82 (`r1-attachments`): no se toma hasta cerrarlo.

### Criterios de aceptación (medibles)
1. Pegar, arrastrar e insertar desde `/` producen un nodo `image` con `src` en `attachments/` y `alt` (test por vía de inserción).
2. Cambiar ancho/alineación/pie/alt persiste en Yjs y sobrevive recargar la página (test de ida y vuelta).
3. Las imágenes fuera del viewport no se cargan hasta hacer scroll (`loading="lazy"` presente en el render, test).
4. Mover la página a otra carpeta y duplicarla deja las imágenes funcionando (test).
5. Textos del editor en `EDITOR_MESSAGES_ES_MX`/`_EN` y en `es-MX.json`/`en.json` de la app.

## 6. Estados vacíos y de error

| Pantalla / estado | Qué se muestra | Acción principal |
|---|---|---|
| Espacio sin páginas (árbol vacío) | Texto explicativo en el árbol | Botón **Nueva página** |
| Carpeta sin hijas (expandida) | Fila secundaria «Sin subpáginas» | Acción **Nueva subpágina** |
| Editor sin página seleccionada | Estado actual (#126) mejorado con accesos | **Nueva página** y **Hoy** |
| Búsqueda sin resultados | Ya existe; mantener patrón | Limpiar filtros |
| Error al cargar el cuerpo | Aviso localizado (patrón `error.generic`) | Reintentar (recarga el doc) |
| Imagen rota (archivo faltante) | Marcador con el `alt` y borde punzado `--border` | Menú contextual: reemplazar o quitar |

Regla de `docs/DESIGN.md`: cada estado vacío explica qué hacer y ofrece la acción principal. Todos los textos en i18n.

## 7. Temas y verificación visual
- Cada ítem se captura en claro y oscuro con `scripts/capture-window.ps1`, con la ventana enfocada, en `docs/screenshots/<issue>-<n>-{light,dark}.png`.
- La revisión visual compara contra `docs/DESIGN.md`: monocromía, foco visible, 4 px, contraste AA.
- Ningún ítem sale de `status:review` sin capturas de ambos temas adjuntas al PR.

## Criterios de aceptación globales
1. `pnpm.cmd check`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo nextest run --workspace` y `scripts/check-denylist.ps1` en verde en cada PR.
2. Los presupuestos de `docs/DOD.md` se mantienen (arranque < 1.5 s con la bóveda de prueba; la franja de pestañas y el árbol no meten trabajo al arranque más allá del primer render).
3. Cada ítem cumple sus criterios numerados de las secciones 1–5 y el revisor visual aprueba claro y oscuro.

## Fuera de alcance
- Restauración de sesión de pestañas (`r1-tabs-restore`, issue propio) y paneles divididos (posterior dentro de #29).
- Explorador de adjuntos (#82) — bloquea a `r1-images` (#114).
- Favoritos, recientes y papelera (#91); accesibilidad general (#83); historial de versiones.
- Cambios en `bindings.ts` o `crates/fossil-core` (si algún ítem los necesita: issue `type:contract` y `status:blocked`).

## Riesgos
- **Archivos i18n compartidos:** varios ítems en paralelo añaden claves a `es-MX.json`/`en.json`; los PRs se mergean en serie y cada uno rebasea antes de tocar las claves.
- **Arrastre en WebView2:** el arrastre de archivos del editor y el de pestañas/filas deben convivir; se usa Pointer Events en shell y se preventDefault solo donde corresponde.
- **`::-webkit-scrollbar` es de Chromium:** si WebView2 cambia de motor, la declaración base `scrollbar-width`/`scrollbar-color` mantiene un fallback aceptable.
- **Rendimiento del árbol:** con miles de objetos, agrupar por `parent` en el cliente es O(n); se mide con la bóveda de 1 000 objetos del DOD y se virtualiza si hace falta.
