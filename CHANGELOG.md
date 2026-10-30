# Changelog

<!--
Cómo escribir aquí:
- "## <versión> · <AAAA-MM-DD>", la más nueva arriba. "## Sin publicar" va siempre primero, arriba de las versiones.
- Una línea entra en "Sin publicar" cuando el cambio ya está en main y se ve en la app. Mientras se revisa, no entra.
- Una línea sale de "Sin publicar" solo al publicar una versión: se mueve entera a la sección de esa versión.
- Una versión publicada no se edita: lo que falte o falle se corrige en la siguiente.
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
- **Páginas con el mismo título**: al enlazar con `[[`, cada una aparece con su página padre o su fecha, y el enlace apunta siempre a la que elegiste. Si escribes a mano un título repetido, queda marcado y un clic te deja elegir la página.
- **Enlazada desde** y **Menciones sin enlace**: panel en cada página que muestra qué páginas apuntan a la actual y cuáles la nombran sin enlazarla, con un botón para crear el enlace en un clic.
- **Esquemas**: sangría con `Tab` y `Shift+Tab`, bloques y secciones plegables, y pegado limpio desde otras aplicaciones.
- **Avisos, tablas y separadores**: nuevos bloques desde el menú `/` o con atajos de Markdown (`>!`, `| col |`, `---`).
- **Arrastrar bloques y conteo en vivo**: reordena cualquier bloque desde su asa lateral y consulta el total de palabras y caracteres al pie de la página.
- **Imágenes en páginas**: pega o arrastra imágenes al editor (`PNG`, `JPG`, `GIF`, `WebP`); se guardan en la carpeta `attachments/` del Espacio y se muestran al volver a abrir la página.
- **Menú de acciones (`⋯`)** en la cabecera de cada página: reúne **Exportar Markdown**, **Exportar PDF** y **Copiar enlace**, y los títulos largos se muestran completos en varias líneas sin cortarse.
- **Pestañas de páginas**: abre varias páginas a la vez (`Ctrl+clic` o clic central), fíjalas, ciérralas con `Ctrl+W` y cambia entre ellas con `Ctrl+Tab` sin perder la posición de lectura.
- **Árbol de páginas y carpetas** en la barra lateral: organiza páginas dentro de carpetas arrastrándolas, pliega o despliega cada nivel y salta a cualquier página desde **Ir a página… (`Ctrl+P`)**.
- **Captura rápida y bandeja del sistema** (`Win+Shift+F`): abre una ventana flotante en cualquier momento para pegar del portapapeles o anotar una idea directo en la Bitácora de hoy; al cerrar la ventana principal, Fossil sigue activo en la bandeja del sistema.
- **Asistente de IA**: chat en un panel con el contexto de tu página y acciones sobre el texto seleccionado. Antes de enviar puedes ver la vista previa del contexto, y funciona con modelos locales o con tu suscripción existente.

### Mejoras
- **Barras de desplazamiento discretas**: en el editor, la barra lateral y los paneles aparecen solo al desplazarse o pasar el cursor, respetando el tema claro y oscuro.

### Ya no falla
- Al abrir la app con el tema oscuro ya no aparece un destello blanco antes de cargar la ventana.
- Deshacer ya revierte un pegado de varios bloques y un salto de bloque con `Enter`, que antes se quedaban en el documento.
- Mover un bloque con `Alt+↑`, `Alt+↓` o su asa lateral ahora se lleva consigo los bloques sangrados que cuelgan de él.

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
