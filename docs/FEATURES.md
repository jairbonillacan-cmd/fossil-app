# Catálogo de funciones

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión; reemplaza el catálogo del plan original

Fossil junta en una app el trabajo que hoy se reparte entre varias categorías de herramientas.
Para cada categoría, este documento dice **qué resuelve**, **qué espera ya la gente** de ella y
**cómo lo hace Fossil** dentro de su grafo de páginas. Es la referencia para escribir specs e issues:
una función nueva debe caber en una de estas secciones o abrir una nueva.

**Estado:** `0.1` lanzada · `Revisión` construida, en revisión de código · `R1`…`R7` release
planeado ([`MILESTONES.md`](MILESTONES.md)) · `Futuro` sin release asignado.
Lo que funciona hoy, medido, está en [`STATUS.md`](STATUS.md).

---

## Conocimiento

### 1. Notas locales enlazadas
**Qué resuelve.** Notas en archivos propios, en tu disco, que se enlazan entre sí. Con el tiempo
forman una red de ideas que se puede navegar en cualquier dirección.
**Qué se espera.** Funciona sin conexión; los archivos son legibles fuera de la app; enlazar
escribiendo el título; ver qué notas apuntan a la actual; buscar al instante.

| En Fossil | Estado | Dónde |
|---|---|---|
| Espacio local: una carpeta con la base SQLite (`.fossil/`) y la copia en Markdown | 0.1 | ADR-0004, `fossil-core::vault` |
| Copia en Markdown de cada página con frontmatter YAML, 2 s después de editar | 0.1 | `fossil-core::mirror` |
| Exportar una página como `.md` | 0.1 | `apps/desktop/src/page-export.ts` |
| Enlaces `[[página]]` con autocompletado; crea la página si no existe | 0.1 | `packages/editor` |
| **Enlazada desde** y **Menciones sin enlace** en el panel derecho | 0.1 | `fossil-core::indexer`, `apps/desktop/src/page-editor-backlinks.tsx` |
| Búsqueda de texto completo con fragmento resaltado | 0.1 | ADR-0004 (FTS5), `fossil-core::search`, `apps/desktop/src/shell-search.tsx` |
| Grafo local y global | R2 | — |
| Copia en Markdown bidireccional (editar el `.md` actualiza la página) | R7 | ADR-0004 |

### 2. Bloques, bases de datos y vistas
**Qué resuelve.** Páginas hechas de bloques que se mueven, y listas de páginas con propiedades que
se ven como tabla, tablero o calendario. Sirve igual para un wiki que para un tracker.
**Qué se espera.** Menú `/` para insertar bloques; arrastrar bloques; propiedades tipadas;
varias vistas sobre los mismos datos; plantillas.

| En Fossil | Estado | Dónde |
|---|---|---|
| Editor de bloques: párrafos, encabezados, listas, tareas, citas y código | 0.1 | ADR-0015, `packages/editor` |
| Menú `/` y atajos de Markdown al escribir | 0.1 | `packages/editor/src/slash-menu.tsx` |
| Avisos (callouts) y tablas | 0.1 | `packages/editor` |
| Arrastrar bloques con asa y conteo de palabras | 0.1 | `packages/editor` |
| Imágenes pegadas o arrastradas, guardadas dentro del Espacio | Revisión | `fossil-core::attachments`, `packages/editor` |
| Campos tipados: texto, número, moneda, fecha, persona, selección, relación, rollup, fórmula | R2 | ADR-0005 |
| Vistas tabla, tablero, lista y calendario sobre cualquier tipo | R2 | — |
| Plantillas por tipo | R2 | — |
| Línea de tiempo y galería | R3 | — |

### 3. Objetos tipados y colecciones
**Qué resuelve.** Que "Proyecto", "Persona" o "Reunión" no sean solo carpetas sino tipos con sus
propios campos, y que una misma cosa pueda ser de varios tipos a la vez.
**Qué se espera.** Crear tipos propios; relaciones entre objetos en ambos sentidos; listas que se
actualizan solas según un criterio; colecciones manuales; espacios separados; cifrado de extremo a extremo.

| En Fossil | Estado | Dónde |
|---|---|---|
| Modelo de objetos: id, tipos, título, bloques, campos y enlaces | 0.1 (núcleo) | ADR-0005, `fossil-core::objects` |
| Varios **Tipos** por página, con campos, plantilla, vista e ícono | R2 | ADR-0005 |
| **Lista guardada** (consulta que se actualiza sola) y **Colección** (lista manual) | R2 | — |
| Espacios de equipo con roles | R3 | ADR-0006, ADR-0007 |
| Espacios privados cifrados de extremo a extremo | R7 | ADR-0007 |

### 4. Outliner y bitácora diaria
**Qué resuelve.** Pensar en listas anidadas que se pliegan, y una nota por día como bandeja de
entrada. Lo que escribes en el día se enlaza solo con los temas.
**Qué se espera.** `Tab` para sangrar; plegar ramas; mover ramas completas; nota del día a un clic;
referenciar e insertar un bloque en otra página; consultas embebidas.

| En Fossil | Estado | Dónde |
|---|---|---|
| **Bitácora**: el botón **Hoy** abre o crea la nota del día | 0.1 | `fossil-core::journal` |
| Esquemas: sangría con `Tab`, bloques y secciones plegables, pegado limpio | 0.1 | `packages/editor` |
| Referencias `((bloque))` e inserción de bloques | R2 | ADR-0005 |
| Consultas embebidas en una página | R5 | — |

### 5. Escritura sin distracciones
**Qué resuelve.** Una app de notas agradable para escribir textos largos, con buena tipografía y
organización ligera por etiquetas.
**Qué se espera.** Tipografía cuidada; modo claro y oscuro; etiquetas anidadas; texto reconocido en
imágenes; exportar a varios formatos.

| En Fossil | Estado | Dónde |
|---|---|---|
| Tema claro, oscuro o del sistema; densidad cómoda o compacta; idioma | 0.1 | `DESIGN.md`, `apps/desktop/src/shell-settings.tsx` |
| Etiquetas `#tag` con autocompletado | 0.1 | `packages/editor` |
| Etiquetas anidadas con ícono | R2 | — |
| Texto en imágenes y PDF con el OCR de Windows | R4 | `fossil-os` |
| Exportar a PDF | 0.1 | `apps/desktop/src/page-export.ts` |
| Exportar a DOCX, HTML y ePub | R7 | — |

### 6. Captura e importación
**Qué resuelve.** Meter información sin fricción: desde cualquier ventana, desde el navegador o
desde otra app de notas.
**Qué se espera.** Atajo global; recortar páginas web; importar carpetas y exportaciones.

| En Fossil | Estado | Dónde |
|---|---|---|
| Paleta de comandos `Ctrl+K` y salto rápido `Ctrl+P` | 0.1 | `apps/desktop/src/shell-palette.tsx` |
| Captura rápida con un atajo global, sin abrir la ventana | Revisión | `fossil-os` |
| Importar Markdown y exportaciones (Markdown, HTML, CSV) de otras apps de notas | R2 | — |
| Recortador web | R6 | — |

---

## Contenido y redes

### 7. Planeación de contenido por marca
**Qué resuelve.** Una agencia o un equipo interno lleva varias marcas, cada una con su tono, sus
pilares de contenido y su calendario mensual, y entrega al cliente una parrilla presentable.
**Qué se espera.** Ficha de marca; campañas con objetivo y presupuesto; parrilla por marca
exportable; reporte mensual.

| En Fossil | Estado | Dónde |
|---|---|---|
| **Marca**: voz, tono, palabras prohibidas, claims, paleta, logos, hashtags y pilares; la usa la IA | R4 | — |
| **Campaña** con presupuesto, KPIs meta, productos ligados y UTM base | R4 | — |
| **Parrilla** por marca, exportable a PDF o imagen con el estilo de la marca | R4 | — |
| Banco de copys, sets de hashtags, constructor de UTM | R4 | — |

### 8. Publicaciones y previsualización
**Qué resuelve.** Escribir una publicación una vez y adaptarla a cada red, viendo cómo quedará
antes de publicarla, con el equipo comentando sobre el mismo borrador.
**Qué se espera.** Vista de calendario, feed y cuadrícula; previsualización fiel por red; comentarios
y sugerencias sobre el texto y la imagen; acciones masivas.

| En Fossil | Estado | Dónde |
|---|---|---|
| **Publicación** con **versiones** por red y por mercado o idioma | R4 | — |
| Previsualización de feed, reel e historia de Instagram, TikTok y Facebook | R4 | `packages/previews` (planeado) |
| Previsualización de LinkedIn, YouTube, Pinterest, X y Threads | R6 | — |
| Vistas calendario (arrastrar y soltar), cuadrícula de Instagram, feed, lista y tablero de estados | R4 | — |
| Validador: longitud, palabras prohibidas, UTM, proporción de imagen, aprobación | R4 | — |
| Comentarios públicos o privados, sugerencias de cambio y anotaciones sobre imagen y PDF | R4 | — |
| Anotaciones con marca de tiempo sobre video | R6 | — |

### 9. Aprobaciones con el cliente
**Qué resuelve.** Que el cliente o el jefe apruebe sin perseguirlo por correo, que quede registro
de quién aprobó qué y que nada salga sin aprobar.
**Qué se espera.** Rondas de revisión en orden; recordatorios automáticos; enlace sin cuenta;
historial auditable.

| En Fossil | Estado | Dónde |
|---|---|---|
| **Aprobación** por rondas ordenadas que avanzan solas | R4 | — |
| Regla "solo lo aprobado se programa" | R4 | — |
| **Enlace de aprobación**: página web para aprobar sin crear cuenta, con la marca del equipo | R4 | `apps/portal` (planeado) |
| Recordatorios automáticos a las 6, 12, 24, 48 y 72 h | R4 | — |
| Auditoría de cada aprobación y cambio | R4 | — |
| Aprobar desde la notificación de Windows | R4 | `fossil-os` |

### 10. Publicación y gestión de redes
**Qué resuelve.** Publicar a la hora correcta sin estar frente a la computadora, y atender lo que
pasa después: comentarios, clics y ventas.
**Qué se espera.** Programación masiva; mejor hora sugerida; bandeja de comentarios; enlaces
cortos medibles; link in bio.

| En Fossil | Estado | Dónde |
|---|---|---|
| Publicación programada de lo aprobado, también en lote | R6 | ADR (por reservar en R6) |
| Mejor hora para publicar según el historial de la cuenta | R6 | — |
| Bandeja de comentarios con sentimiento detectado por IA | R6 | — |
| **Enlaces con seguimiento**: enlaces cortos y link in bio con productos de la tienda | R6 | — |
| Mensajes directos, competidores y seguimiento de hashtags | Futuro | — |

---

## Comercio y datos

### 11. Panel de e-commerce y rentabilidad
**Qué resuelve.** Ver en una pantalla cómo va la tienda y si los anuncios están dejando dinero, sin
cruzar a mano el panel de la tienda con el de cada red de anuncios.
**Qué se espera.** Ventas, pedidos, ticket promedio y conversión; gasto en anuncios y retorno por
canal; costo de adquirir un cliente nuevo; margen real después de costos.

| En Fossil | Estado | Dónde |
|---|---|---|
| Conectores: Shopify (pedidos, productos, clientes, descuentos, costos), Meta Ads, Google Ads, TikTok Ads, GA4 | R5 | `fossil-data` |
| Panel de salud de las conexiones y reautorización | R5 | — |
| Resumen: ventas, pedidos, AOV, CVR, gasto, MER, ROAS por canal, nCAC, % de clientes nuevos, contra el periodo anterior | R5 | `GLOSSARY.md` § Métricas |
| **Rentabilidad**: ventas − costo de producto − envío − comisiones − anuncios − gastos fijos = margen de contribución diario | R5 | — |
| LTV y cohortes por mes de primera compra, canal y producto de entrada | R5 | — |
| **Producto 360**: ventas, campañas y publicaciones que lo empujan, inventario | R5 | — |

### 12. Atribución y rendimiento creativo
**Qué resuelve.** Saber qué canal, campaña y pieza de contenido trajo cada venta, y qué creativos
conviene repetir.
**Qué se espera.** Varios modelos de atribución; encuesta "¿cómo nos conociste?"; rendimiento por
creativo con gasto, CTR, CPA y ventas.

| En Fossil | Estado | Dónde |
|---|---|---|
| Atribución con UTM, datos de origen de la tienda y GA4; modelos primer clic, último clic y lineal | R5 | — |
| Encuesta poscompra desde el checkout de la tienda | R5 | — |
| **Creativos**: rendimiento por pieza, ligado a sus publicaciones y anuncios | R5 | — |
| Píxel propio, multitoque, modelos de mezcla de medios e incrementalidad | Futuro | — |

### 13. Reportes, metas y alertas
**Qué resuelve.** El reporte mensual que hoy se arma a mano, y enterarse a tiempo cuando un número
se sale de lo normal.
**Qué se espera.** Plantillas de reporte que se llenan solas; metas por KPI; alertas; envío
programado por correo o enlace.

| En Fossil | Estado | Dónde |
|---|---|---|
| Metas por KPI con alertas por notificación, correo o Slack | R5 | — |
| Reportes con plantillas dinámicas, resumen escrito por IA, PDF o enlace y envío programado | R5 | — |
| Bloques de consulta dentro de las notas (constructor visual o SQL) con gráficas en vivo | R5 | `fossil-data` |
| Paquete de análisis opcional para datasets grandes (CSV, Excel, Parquet) | R5 | ADR-0008 |
| Objetivos (OKR) enlazados a KPIs | R5 | — |

---

## IA y automatización

### 14. Asistente y agente
**Qué resuelve.** Escribir, resumir y analizar con IA sin copiar contexto a otra ventana, usando los
modelos que la persona ya paga o los que corren en su computadora.
**Qué se espera.** Chat con el contexto de la página; acciones rápidas sobre la selección; un agente
que puede actuar dentro de la app con permiso; costo visible.

| En Fossil | Estado | Dónde |
|---|---|---|
| Proveedores con clave propia: Anthropic, OpenAI y Gemini; claves en el almacén de credenciales de Windows | 0.1 (núcleo) | ADR-0011, `fossil-ai` |
| Modelos locales con Ollama | 0.1 (núcleo) | `fossil-ai` |
| CLIs de IA ya instalados y con sesión iniciada, como procesos hijo; Fossil nunca lee sus credenciales | 0.1 (núcleo) | ADR-0011, ADR-0013, `fossil-bridge` |
| **Modelos de IA**: router por tarea con cadena de respaldo y registro de costo | 0.1 (núcleo) | `fossil-ai` |
| Chat con contexto: página, selección y `@páginas` | Revisión | `docs/specs/r1-ai-router-bridge.md` |
| Reescribir, resumir, traducir y cambiar el tono de una selección | Revisión | `docs/specs/r1-ai-router-bridge.md` |
| Agente con las herramientas de la paleta; confirma lo destructivo o externo | R2 | — |
| Contador de costos y topes por mes | R2 | — |
| Voz de marca en todo el contenido; ideas por pilar; campos que llena la IA | R4 | — |
| Agente analista: responde en lenguaje natural mostrando el SQL, detecta anomalías y pronostica; solo sugiere, nunca ejecuta | R5 | — |
| Búsqueda semántica y respuestas con citas | R5 | ADR-0004 (sqlite-vec) |
| Reuniones: grabar, transcribir, resumir y crear tareas | R7 | — |

### 15. Automatizaciones, MCP y extensiones
**Qué resuelve.** Que lo repetitivo pase solo, y que otras herramientas y agentes puedan leer y
escribir en Fossil.
**Qué se espera.** Disparadores y acciones sin código; API; un servidor MCP; extensiones con permisos.

| En Fossil | Estado | Dónde |
|---|---|---|
| Servidor MCP local (127.0.0.1 y token) para que agentes externos lean y escriban páginas | R2 | `fossil-mcp` |
| Cliente MCP con presets: Shopify, GA4, Drive, Canva, GitHub, sistema de archivos | R2 | `fossil-mcp` |
| Automatizaciones: disparador (creado, campo cambiado, horario, webhook) → condiciones → acciones (IA, campos, crear, notificar, herramienta MCP) | R5 | — |
| MCP remoto con token, API REST local y enlaces `fossil://` | R5 | — |
| Extensiones v1 en iframe aislado con permisos | R7 | — |
| Extensiones WebAssembly y tienda | Futuro | — |

---

## Equipo y plataforma

### 16. Colaboración
| En Fossil | Estado | Dónde |
|---|---|---|
| Cuentas (enlace mágico y Google) y Espacios de equipo | R3 | ADR-0006 |
| Roles: dueño, admin, editor, comentador, invitado y cliente | R3 | ADR-0007 |
| Edición en vivo con presencia y cursores | R3 | ADR-0003, ADR-0006 |
| Comentarios con hilos, menciones y centro de notificaciones | R3 | — |
| Historial de versiones con restauración | R3 | ADR-0003 |
| Permisos por página y auditoría de actividad | R7 | — |
| Sincronización entre equipos de la misma red local | Futuro | — |

### 17. Experiencia de escritorio
| En Fossil | Estado | Dónde |
|---|---|---|
| Ventana nativa de Windows 11 con Mica; tema y densidad aplicados antes de mostrarla | 0.1 | `DESIGN.md` |
| Sin destello blanco de WebView2 al arrancar | 0.1 | `apps/desktop/src-tauri/tauri.conf.json` |
| Instancia única y posición de la ventana recordada | 0.1 | `docs/modules/infra.md` |
| Pestañas, paneles divididos y panel derecho | R1 | `docs/specs/r1-shell-ux.md` |
| Recordatorios con notificación de Windows; bandeja Hoy, Próximo, Atrasado | R2 | `fossil-os` |
| Firma de código y actualizaciones automáticas (estable y beta) | R7 | — |
| Listas de salto, onboarding e interfaz en inglés completa | R7 | — |
| App móvil compañera | Futuro | — |
