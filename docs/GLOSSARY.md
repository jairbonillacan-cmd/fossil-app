# Glosario

Los nombres en la interfaz se decidieron en ADR-0017. La columna **En la interfaz** es el único nombre que ve la persona usuaria, en la app, el sitio, el changelog y el roadmap. **Interno** es como lo llamamos en el código y en los docs.

## Producto

| En la interfaz | Interno | Significado |
|---|---|---|
| **Espacio** | Bóveda / vault · Space | Donde vive el trabajo. Uno local es una carpeta de tu equipo (`.fossil/` con SQLite más la copia en Markdown). Uno de equipo (R3+) suma miembros, roles y modo de cifrado (*gestionado* o *privado E2EE*) |
| **Página** | Objeto / object | Unidad básica: id, tipo(s), título, bloques, relaciones y enlaces. Todo lo que abres es una página |
| **Tipo** | TypeKey | Define los campos, la plantilla y la vista de una página. Una página puede tener varios tipos |
| **Campo** | Relación / propiedad | Propiedad tipada de una página: texto, fecha, persona, relación con otra página, fórmula… |
| **Bloque** | Bloque / block | Párrafo o elemento del editor, con ID propio. Se puede referenciar `((ref))` y embeber |
| **Lista guardada** | Búsqueda viva / Set | Búsqueda guardada que se actualiza sola y se muestra con cualquier vista |
| **Colección** | Colección | Lista manual de páginas |
| **Vista** | Vista | Forma de mostrar una lista: tabla, tablero, calendario, línea de tiempo, galería, feed, cuadrícula de Instagram… |
| **Bitácora** (botón **Hoy**) | Journal | Una nota por día, que funciona como tablero del día |
| **Copia en Markdown** | Espejo / mirror | El `.md` de cada página, que se escribe 2 s después de cada cambio. Solo exportación |
| **Enlazada desde** | Backlinks | Páginas que enlazan a la actual |
| **Menciones sin enlace** | Unlinked mentions | Páginas que nombran a la actual sin enlazarla |
| **Paleta de comandos** | Command palette | Ctrl+K para acciones y Ctrl+P para saltar a una página |
| **Captura rápida** | Quick capture | Atajo global para anotar sin abrir la ventana |

## Contenido y comercio

| En la interfaz | Interno | Significado |
|---|---|---|
| **Marca** | Brand | Voz, tono, palabras prohibidas, paleta y pilares de una marca. La usa la IA |
| **Publicación** y sus **versiones** | Post madre / Variante | Una pieza de contenido con versiones por red y por mercado o idioma |
| **Parrilla** | Parrilla | Publicaciones por día y por marca, exportable a PDF o imagen con el estilo de la marca |
| **Aprobación** | Flujo de aprobación | Rondas ordenadas de revisores. Solo se programa lo aprobado |
| **Enlace de aprobación** | Portal de cliente | Página web para aprobar contenido sin cuenta, con un enlace seguro |
| **Creativos** | Creative / Asset | Imágenes y videos ligados a las publicaciones y anuncios donde se usaron, con su rendimiento |
| **Rentabilidad** | Profit | Ventas, costos y margen por día, canal y producto |
| **Enlaces con seguimiento** | TrackedLink | Enlaces cortos que registran clics y ventas |
| **Modelos de IA** | Router de IA | Qué proveedor responde (suscripción, API o local) según la tarea |
| **Usar mi suscripción** | Puente / Bridge (`fossil-bridge`) | Ejecuta los CLIs oficiales (agy, claude, codex) con la sesión del usuario |

## Métricas

| En la interfaz | Significado |
|---|---|
| **MER** | Marketing Efficiency Ratio = ventas totales ÷ gasto total en ads |
| **ROAS** | Ventas atribuidas ÷ gasto en ads del canal o campaña |
| **nCAC** | Costo de adquisición de cliente *nuevo* = gasto en ads ÷ clientes nuevos |
| **Margen de contribución** | Ventas − COGS − envío − comisiones − ads |

## Solo interno

| Término | Significado |
|---|---|
| **ACP** | Agent Client Protocol: protocolo para controlar agentes de CLI desde otra app |
| **MCP** | Model Context Protocol: la app actúa como cliente y como servidor |
| **Spike** | Investigación con tiempo fijo para reducir un riesgo técnico |
| **Contrato** | Tipos, comandos IPC y esquema acordados antes de trabajar en paralelo |
