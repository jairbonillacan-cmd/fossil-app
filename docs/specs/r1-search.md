# Spec R1: Búsqueda

**Área:** `area:storage`, `area:ui`

## Features
- **Motor:**
  - Índice FTS5 sobre título (con más peso) y cuerpo.
  - Tokenizer `unicode61 remove_diacritics 2`, para que "campaña" encuentre "campana".
- **Búsqueda global:**
  - Pantalla completa con resultados agrupados por objeto y con snippets resaltados.
  - Filtros por tipo (página o journal), por tag y por fecha de modificación.
  - Operadores: `"frase exacta"`, `-excluir`, `tag:x` y `type:journal`.
- **Integración:** la paleta `Ctrl+K` y el quick switcher usan el mismo comando `search_query(q, filters, limit)`.
- **Búsqueda en página:** `Ctrl+F`, con resaltado dentro del editor.

## Criterios de aceptación
- Con 10 000 objetos, la consulta responde en < 50 ms (p95) y la búsqueda mientras se escribe va sin lag (debounce de 80 ms).
- Los acentos y la ñ se manejan correctamente.
- Hay tests unitarios del parser de operadores.

## Fuera de alcance
Búsqueda semántica (R5) y OCR (R4).
