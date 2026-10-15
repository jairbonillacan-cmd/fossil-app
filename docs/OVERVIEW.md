# Fossil: la app

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión · **Versión:** 0.1.1-alpha.2

Este documento explica qué es Fossil, para quién es y cómo se usa. El detalle de cada función está
en [`FEATURES.md`](FEATURES.md); lo que ya funciona, en [`STATUS.md`](STATUS.md); cómo está hecha,
en [`ARCHITECTURE.md`](ARCHITECTURE.md).

## El problema

Un equipo de marketing y e-commerce trabaja hoy en cinco o seis herramientas que no se hablan:
las ideas y los briefs en una app de notas, las tareas en un gestor de proyectos, el calendario de
publicaciones y las aprobaciones del cliente en otra plataforma, los resultados de los anuncios en
los paneles de cada red, las ventas en la tienda en línea y el reporte del mes en una hoja de
cálculo que alguien arma a mano.

El costo no es la suscripción de cada herramienta. Es que **nadie puede responder preguntas
sencillas** sin copiar datos de un lado a otro:

- ¿Qué creativo vendió más este mes, y en qué publicaciones y anuncios se usó?
- ¿Qué ideas del brief de marzo llegaron a publicarse y cuáles se quedaron en borrador?
- ¿El cliente ya aprobó la parrilla de la semana, o sigue en la segunda ronda?
- ¿Cuánto margen dejó la campaña de temporada, después de anuncios, envío y comisiones?

## Qué es Fossil

Fossil es una app de escritorio para Windows donde **todo el trabajo del equipo es una página en un
mismo grafo**. Una nota, una tarea, una publicación, una campaña, un creativo, un producto, un pedido
y un reporte son páginas con tipo, campos y enlaces entre sí. Como viven juntas, la respuesta a las
preguntas de arriba es una consulta, no una tarde de hojas de cálculo.

Fossil cierra este ciclo en una sola app:

```
idea → contenido → aprobación → publicación → anuncio → venta → aprendizaje
```

## Para quién

| Persona | Qué hace en Fossil |
|---|---|
| Estratega o líder de marketing | Escribe briefs y planes, define la marca, revisa resultados por campaña |
| Community manager | Arma la parrilla del mes, escribe versiones por red, gestiona aprobaciones |
| Diseñador o creativo | Sube creativos, ve dónde se usaron y cómo rindieron |
| Analista de e-commerce | Consulta ventas, margen, atribución y cohortes sin exportar datos |
| Cliente o aprobador externo | Aprueba contenido desde un enlace, sin crear cuenta |
| Cualquier persona | Usa Fossil como su app de notas y tareas, sin la parte de equipo |

## Conceptos

Los nombres de la interfaz están en [`GLOSSARY.md`](GLOSSARY.md). Los cinco que importan:

| Concepto | Qué es |
|---|---|
| **Espacio** | Donde vive el trabajo. Uno local es una carpeta de tu computadora; uno de equipo suma miembros, roles y sincronización |
| **Página** | La unidad de todo. Tiene título, bloques de contenido, uno o varios tipos, campos y enlaces |
| **Tipo** | Define qué campos, plantilla y vista tiene una página: *Tarea*, *Publicación*, *Campaña*, *Producto*… Puedes crear los tuyos |
| **Bloque** | Cada párrafo, lista, tabla o imagen dentro de una página. Tiene su propio ID, así que se puede enlazar e insertar en otra página |
| **Vista** | La forma de ver una lista de páginas: tabla, tablero, calendario, galería, parrilla de redes |

## Un día con Fossil

Un ejemplo con una marca ficticia, *Acme*:

1. **Lunes, 9:00.** Abres Fossil y presionas **Hoy**. La nota del día ya tiene las tareas que vencen
   y las publicaciones que salen esta semana.
2. **Brief.** Escribes el brief de la campaña *Acme Verano* como una página de tipo *Campaña*:
   objetivo, presupuesto, productos. Escribes `[[` y enlazas los productos que vas a empujar.
3. **Contenido.** Desde la campaña creas diez *Publicaciones*. Cada una tiene versiones para
   Instagram y TikTok, con previsualización de cómo se verá en cada red. La IA propone copys
   usando la voz de marca de Acme.
4. **Aprobación.** Envías la parrilla al cliente con un enlace. El cliente comenta y aprueba sin
   crear cuenta. Solo lo aprobado se puede programar.
5. **Publicación y anuncios.** Las publicaciones aprobadas salen a la hora elegida. Los anuncios que
   usan esos creativos se conectan solos por UTM.
6. **Resultados.** Dos semanas después, la página del creativo muestra en qué publicaciones y
   anuncios se usó, cuánto se gastó y cuánto vendió en la tienda. El reporte mensual se arma con esos
   datos y la IA escribe el resumen.

Los pasos 1 y 2 ya funcionan en parte (ver [`STATUS.md`](STATUS.md)); el resto llega por releases
([`MILESTONES.md`](MILESTONES.md)).

## Principios

1. **Un solo grafo.** Nada vive en un silo: cualquier página se puede enlazar y consultar desde otra.
2. **Local primero.** Tu Espacio es una carpeta en tu computadora y funciona sin internet. La nube
   sincroniza al equipo y hace lo que la computadora no puede: publicar a una hora, mandar
   recordatorios, recibir aprobaciones.
3. **Sin encierro.** Cada página se guarda también como Markdown. Puedes exportar todo cuando
   quieras, y hay API local y servidor MCP.
4. **Teclado primero.** `Ctrl+K` llega a cualquier acción. Las acciones de la paleta son las mismas
   herramientas que usan la IA y el servidor MCP.
5. **IA bajo tu control.** Usa tus propias claves de API, modelos locales o los CLIs de IA que ya
   tengas instalados y con sesión iniciada. Ves qué modelo responde y cuánto cuesta. Nada externo o
   destructivo pasa sin confirmación.
6. **Ligera.** Presupuestos que CI mide en cada PR de código: instalador < 30 MB, arranque < 1.5 s y
   RAM en reposo < 200 MB. La búsqueda en 10 000 páginas (< 50 ms) tiene su propio bench
   ([`PERFORMANCE.md`](PERFORMANCE.md)).
7. **En tu idioma.** Español de México por defecto, inglés disponible.

## Qué no es

- **No es un CRM ni un ERP.** Lee pedidos, productos y clientes de la tienda; no los administra.
- **No es una app web.** Es una app de escritorio. El portal de aprobaciones es la única parte web.
- **No es multiplataforma (todavía).** Solo Windows 11. Una app móvil compañera está en Futuro.
- **No entrena modelos con tus datos.** Fossil no tiene servidor de IA propio; tus páginas van solo al
  proveedor que elijas, cuando lo uses ([`PRIVACY.md`](PRIVACY.md)).
