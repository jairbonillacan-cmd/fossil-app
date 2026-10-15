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
- **Exportar Markdown** en la cabecera de cada página: descarga la página completa como `.md`.
- **Exportar PDF** en la cabecera de cada página: abre la impresión para guardarla como PDF, siempre en tema claro y sin la barra lateral.

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
