# ADR-0004: SQLite local + espejo Markdown

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:storage`

## Decisión
- **Base local:** la bóveda contiene `.fossil/fossil.db` (SQLite en modo WAL, vía rusqlite), con:
  - updates y snapshots del CRDT;
  - tablas materializadas (`objects`, `relations`, `links`, `blocks`);
  - **FTS5** para búsqueda;
  - **sqlite-vec** para embeddings (R5).
- **Espejo Markdown:** cada página se exporta a un `.md` con frontmatter YAML. **Solo exportación hasta R7**; la importación bidireccional (con el watcher `notify`) llega en R7.

## Por qué
SQLite da velocidad y consultas; Markdown da portabilidad y evita el lock-in (la bóveda se puede abrir con cualquier editor de Markdown). La importación bidireccional sobre un CRDT es difícil, así que se pospone.

## Consecuencias
La fuente de verdad es el CRDT en SQLite, nunca el `.md`. Hasta R7, editar el `.md` desde fuera no tiene efecto, y la UI debe avisarlo.
