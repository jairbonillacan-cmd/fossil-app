# Spec R1: Editor de bloques

**Área:** `area:editor` · **ADRs:** 0003 · **Paquete:** `packages/editor`

## Qué y por qué
Es donde el usuario pasa la mayor parte del tiempo. Escribir debe sentirse tranquilo y sin fricción, los bloques se manipulan uno por uno y las listas se pueden usar como outline (sangrar, plegar, mover ramas).

## Base técnica
- TipTap 3 (ProseMirror), **solo extensiones con licencia MIT**.
- Colaboración y persistencia con `y-prosemirror`, ligado al doc Yjs del objeto.
- El doc se carga con `object_load_doc` y cada update local se envía con `object_apply_update` (agrupando cada 250 ms).

## Features R1
- **Bloques con ID único:** párrafo, H1–H3, listas (con viñetas, numeradas, de tareas), cita, callout, código con Shiki (carga perezosa), divisor, imagen (archivo copiado a `<bóveda>/attachments/`) y tabla simple.
- **Slash menu** (`/`) y **drag handle** para reordenar bloques.
- **Atajos Markdown en vivo:** `#`, `-`, `1.`, `[]`, `>`, ``` ``` ```, `**`, `_`, `` ` ``.
- **Modo outliner:** `Tab` / `Shift+Tab` cambian la sangría; los bloques se pueden plegar.
- **Wikilinks:** al escribir `[[` aparece un autocompletado de objetos. Si no existe, se ofrece "Crear «X»". `Ctrl+clic` abre el objeto en una pestaña nueva.
- **Tags:** al escribir `#` aparece un autocompletado; se admiten tags anidados `#marca/acme`.
- **Menciones no enlazadas:** la acción "Enlazar" está en el panel de backlinks.
- **Plegado** de secciones por encabezado.
- **Contador** de palabras y caracteres en la barra de estado.

## Spike previo (obligatorio, 1–2 días)
TipTap 3 + y-prosemirror + IDs de bloque + outliner con 5 000 bloques.
- **Medir:** tiempo de carga, latencia al teclear (< 16 ms) y memoria.
- **Entregable:** una nota en el issue con los hallazgos y, si cambia algo de la spec, un ADR nuevo.

## Criterios de aceptación
- Escribir en un documento de 5 000 bloques no produce frames de más de 16 ms (perfilado en el PR).
- Deshacer y rehacer funcionan por usuario (`Y.UndoManager`).
- Pegar desde Word, Google Docs o la web da Markdown limpio, sin estilos basura.
- Hay un test e2e: crear una página, escribir `[[Nueva]]`, crearla y ver el backlink.

## Fuera de alcance
Refs y embeds de bloque `((ref))` (R2), KaTeX y Mermaid (R2), comentarios (R3), sugerencias (R4).
