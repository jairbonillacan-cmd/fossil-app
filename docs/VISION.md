# Visión de Fossil

## Para quién
Para los equipos de **marketing, e-commerce, análisis de datos y redes sociales** de cualquier empresa, y para cualquier persona que la descargue. Corre en **Windows** como app nativa.

## Qué problema resuelve
Hoy el trabajo de estos equipos está repartido entre una app de notas, un gestor de tareas, una herramienta de calendario y aprobación de contenido, un dashboard de ventas y anuncios, la tienda en línea y varias hojas de cálculo. Ninguna sabe lo que pasa en las otras. Fossil lo junta en **un solo grafo de objetos**:

> idea → contenido → aprobación → publicación → anuncio → venta en Shopify → aprendizaje

Por ejemplo, un creativo sabe en qué posts y anuncios se usó y cuánto vendió.

## Principios (no negociables)
1. **Un solo grafo de objetos.** Nota, tarea, post, campaña, creativo, producto, pedido y reporte son objetos enlazables y consultables.
2. **Local-first.** Funciona offline; la nube sincroniza y ejecuta lo que el cliente no puede.
3. **Teclado primero.** Ctrl+K resuelve todo, y sus acciones son las mismas herramientas que usan la IA y el servidor MCP.
4. **La IA es ciudadana de primera.** Usa las suscripciones del usuario a través de sus CLIs oficiales, claves de API (BYOK) o modelos locales, mediante un router. El costo es visible, y nada externo o destructivo pasa sin confirmación.
5. **Ligera.** Arranque < 1.5 s, RAM en reposo < 200 MB, instalador < 30 MB, búsqueda < 50 ms con 10 000 objetos.
6. **Tranquila al escribir, densa al consultar.** Efecto Mica, buena tipografía, es-MX por defecto.
7. **Sin lock-in.** Exportación a Markdown y JSON, API local y MCP.

## Cómo llegamos
Releases verticales cada 6–8 semanas, cada una instalable y usada por el equipo. Reutilizamos antes de construir. Lo difícil se pospone, no se borra. Detalle en [MILESTONES.md](MILESTONES.md).
