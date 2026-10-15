# Mapas de módulo

Hay un archivo por `area:`, por ejemplo `editor.md` o `storage.md`. Cada uno tiene **≤80 líneas** y lo actualiza el PR que cambia el módulo. Se crea cuando nace el módulo, a partir de esta plantilla:

```md
# <área>
**Propósito:** una frase.
**Rutas:** `crates/...`, `apps/desktop/src/modules/...`
**Contratos públicos:** comandos IPC / tipos / eventos (enlaza al archivo generado)
**Archivos clave:**
- `ruta` — qué hace
**Cómo probar:** comandos
**Gotchas:** cosas no obvias que muerden
**ADRs relacionados:** 000X
```
