# ADR-0003: Yjs (UI) + yrs (Rust) como modelo CRDT

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:objects`

## Contexto
Fossil es local-first con colaboración: las ediciones hechas offline deben fusionarse sin conflictos, y debe haber un solo mecanismo de sync para notas, tareas, posts y bases de datos.

## Decisión
**Cada objeto es un documento Yjs:**
- El cuerpo es un `Y.XmlFragment` (vía `y-prosemirror`).
- Las relaciones y propiedades viven en un `Y.Map`.
- En Rust, **yrs** persiste los updates, materializa las tablas e indexa.
- El sync de R3 usa Hocuspocus (ADR-0006).

## Consecuencias
- El modelo queda listo para sync desde R1, así R3 no obliga a reescribir.
- Hay que compactar los updates (snapshots) periódicamente.
- Los merges se prueban con proptest.

## Alternativas
- **Loro:** muy rápido, pero sus bindings son jóvenes, sobre todo los de ProseMirror.
- **Automerge:** menos integración con editores ricos.
- **cr-sqlite:** sincroniza filas, pero no texto enriquecido.
