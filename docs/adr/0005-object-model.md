# ADR-0005: Modelo de objetos unificado (Objeto + Tipo + Relaciones)

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:objects`

## Decisión
- Todo lo que el usuario maneja es un **Objeto**: página, tarea, post, campaña, creativo, producto, reporte…
- Cada objeto tiene uno o varios **Tipos**: un tipo define campos, plantilla y vista, y un objeto puede tener varios.
- Cada tipo define:
  - **Relaciones** (campos tipados);
  - plantilla;
  - vista por defecto;
  - ícono.
- Los **Bloques** tienen ID y se pueden referenciar.
- Las **Búsquedas vivas** son queries guardadas sobre tipos y campos.

## Por qué
Es lo que hace posible el diferenciador: enlazar y consultar contenido, trabajo y datos sin silos. Contenido, Tareas y Comercio no son bases aparte, sino *tipos incluidos con vistas especializadas*.

## Consecuencias
- El core (`fossil-core`) es genérico; cada módulo aporta tipos, vistas y validaciones.
- Hay que cuidar el rendimiento de las queries: tablas materializadas con índices por tipo y por campo.
