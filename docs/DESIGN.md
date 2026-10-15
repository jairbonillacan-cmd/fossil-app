# Guía de diseño

> Borrador de R0. El issue de design tokens lo completa y crea `packages/ui`.

## Sensación
Calma visual al escribir y densidad de información en listas y vistas. Nativa de Windows 11: fondo **Mica**, controles de ventana nativos, toasts del sistema.

## Fondo de la ventana (Mica)
Mica la dibuja **Windows** (DWM) detrás de la ventana transparente (`windowEffects: ["mica"]` en `tauri.conf.json`). Fossil no pinta fondo propio en `html`/`body`; lo que se ve depende del sistema:

| Situación | Qué se ve | Quién lo decide |
|---|---|---|
| Ventana activa y transparencia del sistema disponible | Mica, una superficie teñida por el wallpaper | Windows |
| Windows no está componiendo transparencias (ventana inactiva, ahorro de energía, transparencia apagada; ver #51) | Color sólido del sistema: `#F3F3F3` en claro, `#202020` en oscuro. **También en la barra de título nativa** | Windows |
| `prefers-reduced-transparency: reduce` | `--bg` opaco desde `styles.css` | Fossil |

Reglas:
- El color sólido del sistema es el comportamiento esperado, no un bug. **Diagnóstico:** si la barra de título nativa también sale plana, es el sistema; si solo sale plano el contenido, es Fossil.
- Fossil no intenta detectar ni corregir el estado de DWM. `UISettings.AdvancedEffectsEnabled` puede valer `true` mientras Windows pinta el color sólido (medido en #51), así que no es una señal fiable.
- Las capturas de revisión visual se toman con la ventana **enfocada** (`scripts/capture-window.ps1`). Si salen planas, compara con la barra de título antes de reportar un bug.

## Fundamentos
- **Tipografía:**
  - UI: **Inter** (variable).
  - Lectura larga: **Literata** (opcional, por usuario).
  - Código: **JetBrains Mono**.
  - Escala base de 14 px en la UI y 16 px en el editor; interlineado de 1.5 en el editor.
- **Color:**
  - Tokens semánticos (`--bg`, `--bg-elevated`, `--fg`, `--fg-muted`, `--border`, `--accent`, `--danger`, `--success`, `--warning`) en tema claro y oscuro.
  - **Paleta de marca: blanco y negro (monocromática).** El acento es negro en tema claro y blanco en tema oscuro, con una escala de grises neutros (sin tinte) para superficies y bordes. El color se reserva para estados semánticos (danger, success, warning) y para los datos de las gráficas.
  - **Logo:** pendiente. Mientras llega, se usa un wordmark "Fossil" en Inter Semibold y un ícono provisional (una "F" en un cuadrado negro).
  - Contraste AA mínimo.
- **Espaciado:** escala de 4 px. Densidad *cómoda* o *compacta*, a elección del usuario.
- **Movimiento:**
  - Transiciones de 120–200 ms con `ease-out`.
  - Sin animaciones decorativas en reposo.
  - Se respeta `prefers-reduced-motion`.
- **Íconos:** Lucide.

## Layout de la app
```
┌ sidebar (widgets, árbol, favoritos) ┬ pestañas ───────────────────────┐
│                                     │ editor / vista (split opcional)  │
│                                     │                                  │
└─────────────────────────────────────┴ panel derecho: IA / backlinks ───┘
```
- **Ctrl+K:** paleta de comandos y búsqueda.
- **Ctrl+P:** quick switcher.
- **Win+Shift+F:** captura rápida global.

## Reglas
- Todo es usable con teclado y tiene foco visible.
- Ninguna lista sin virtualizar si puede pasar de 200 elementos.
- Cada estado vacío explica qué hacer y ofrece la acción principal.
- Los textos de UI van en i18n (es-MX por defecto).
