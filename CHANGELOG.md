# Changelog

<!--
Cómo escribir aquí:
- "## <versión> · <AAAA-MM-DD>", la más nueva arriba. "## Sin publicar" para lo que ya está en main.
- Grupos, solo los que apliquen: ### Novedades · ### Mejoras · ### Ya no falla
- Una línea por cambio, desde el punto de vista de quien usa Fossil. Qué cambia, no cómo se hizo.
- Nada interno: sin números de issue o PR, nombres de crates, CI, agentes ni métricas.
- Sin nombres de otros productos ni comparaciones.
- Lo que no se ve en la app (backend sin interfaz) no entra hasta que se vea.
-->

## Sin publicar

### Novedades
- **Búsqueda** en todo el espacio: encuentra páginas por texto (con o sin acentos), etiqueta (`tag:`), tipo (`type:`) o fechas, con el fragmento donde aparece resaltado.
- **Buscar en la página** con `Ctrl+F`: resalta todas las coincidencias y salta de una a otra.
- **Paleta de comandos** con `Ctrl+K` para ejecutar cualquier acción o buscar páginas, y `Ctrl+P` para saltar directo a una página por su título.
- **Enlaces y etiquetas al escribir**: escribe `[[` para enlazar otra página (o crearla si no existe) y `#` para autocompletar etiquetas, incluidas las anidadas (`#marca/acme`).
- **Enlazada desde** y **Menciones sin enlace**: panel en cada página que muestra qué páginas apuntan a la actual y cuáles la nombran sin enlazarla, con un botón para crear el enlace en un clic.
- **Esquemas**: sangría con `Tab` y `Shift+Tab`, bloques y secciones plegables, y pegado limpio desde otras aplicaciones.
- **Avisos, tablas y separadores**: nuevos bloques desde el menú `/` o con atajos de Markdown (`>!`, `| col |`, `---`).
- **Arrastrar bloques y conteo en vivo**: reordena cualquier bloque desde su asa lateral y consulta el total de palabras y caracteres al pie de la página.
- **Imágenes en páginas**: pega o arrastra imágenes al editor (`PNG`, `JPG`, `GIF`, `WebP`); se guardan en la carpeta `attachments/` del Espacio y se muestran al volver a abrir la página.
- **Exportar Markdown** en la cabecera de cada página: descarga la página completa como `.md`.
- **Exportar PDF** en la cabecera de cada página: abre la impresión para guardarla como PDF, siempre en tema claro y sin la barra lateral.

### Ya no falla
- Al abrir la app con el tema oscuro ya no aparece un destello blanco antes de cargar la ventana.
- Deshacer ya revierte un pegado de varios bloques y un salto de bloque con `Enter`, que antes se quedaban en el documento.

## 0.1.1-alpha.2 · 2026-10-14

### Novedades
- Ajustes: tema claro, oscuro o del sistema, densidad de la interfaz e idioma.

### Mejoras
- El tema y la densidad se aplican antes de que aparezca la ventana. Ya no hay parpadeo al abrir.
- Con el tema oscuro, la barra de título también es oscura.
- Nuevo icono de la app.

## 0.1.0-alpha.1 · 2026-10-14

Primera alpha.

### Novedades
- Espacios: crea uno o abre una carpeta existente. Los recientes aparecen al iniciar.
- Editor de bloques con párrafos, encabezados, listas, tareas, citas y código.
- Escribe `/` para insertar un bloque. Los atajos de Markdown (`#`, `-`, `1.`, `[]`, `>`) funcionan mientras escribes.
- Bitácora: **Hoy** abre la nota del día y la crea si no existe.
- Copia en Markdown: cada página se guarda también como un archivo `.md` que puedes abrir con cualquier editor.
- Todo se guarda solo. No hay botón de guardar.

### Ya no falla
- El corrector ortográfico ya no subraya el texto de los bloques de código.
- Cambiar solo las mayúsculas del título de una página ya no borra su archivo `.md`.

## 0.0.1 · 2026-10-14

Compilación interna. Sin funciones para usuarios todavía.
