# Spec R1: Shell de la app y UX base

**Área:** `area:ui`, `area:os` · **Docs:** `docs/DESIGN.md`

## Features
- **Primer arranque:** pantalla para crear o abrir una bóveda, con la lista de bóvedas recientes.
- **Sidebar:**
  - Árbol de páginas con drag-and-drop para cambiar el padre.
  - Favoritos.
  - Sección "Hoy" (abre el journal del día).
  - Tags.
  - Se puede colapsar.
- **Pestañas:**
  - Abrir, cerrar, reordenar y fijar.
  - Atajos `Ctrl+W` y `Ctrl+Tab`.
  - Las pestañas abiertas se restauran al reabrir la app.
- **Paneles divididos:** vertical, para tener dos objetos lado a lado.
- **Panel derecho** colapsable con dos secciones: *Backlinks* (y menciones no enlazadas) y *IA* (spec de IA).
- **Paleta de comandos** `Ctrl+K`:
  - Busca objetos (FTS) y comandos.
  - Registro de comandos tipado: `registerCommand({ id, title, shortcut, run })`. Es el mismo registro que expondrán la IA y el MCP en R2.
- **Quick switcher** `Ctrl+P` (solo objetos, por título, con búsqueda difusa).
- **Captura rápida global** `Win+Shift+F` (configurable):
  - Mini ventana flotante.
  - El texto se añade al journal de hoy, o a un objeto elegido.
  - Funciona aunque la app esté minimizada en la bandeja.
- **Bandeja del sistema:** abrir, nueva captura, salir.
- **Tema:** claro, oscuro o del sistema. Densidad cómoda o compacta.
- **Exportar** el objeto actual a Markdown y a PDF (usando la impresión de WebView2).
- **Ajustes:** bóveda, tema, atajos, idioma e IA.

## Criterios de aceptación
- Todo se puede hacer con teclado, con el foco siempre visible.
- Arranque en frío hasta la ventana interactiva < 1.5 s con una bóveda de 1 000 objetos.
- La captura rápida aparece en < 300 ms tras el atajo.

## Fuera de alcance
Widgets del sidebar (R2), vistas de base de datos (R2), centro de notificaciones (R3).
