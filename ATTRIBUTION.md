# Atribuciones

Fossil se publica bajo AGPL-3.0-or-later. Los recursos de terceros incluidos en el repositorio conservan su
propia licencia, guardada junto al archivo. Todo recurso nuevo entra con su licencia al lado y una
fila aquí, en el mismo PR.

## Recursos incluidos

| Ruta | Recurso | Autor | Fuente | Licencia |
|---|---|---|---|---|
| `packages/ui/fonts/InterVariable*.woff2` | Inter (variable, normal e itálica) | The Inter Project Authors | https://github.com/rsms/inter | SIL OFL 1.1 (`packages/ui/fonts/OFL-Inter.txt`) |
| `packages/ui/fonts/JetBrainsMono-Variable*.woff2` | JetBrains Mono (variable, normal e itálica) | The JetBrains Mono Project Authors | https://github.com/JetBrains/JetBrainsMono | SIL OFL 1.1 (`packages/ui/fonts/OFL-JetBrainsMono.txt`) |
| `apps/desktop/app-icon.svg`, `apps/desktop/src-tauri/icons/*` | Ícono provisional "F" | Contribuidores de Fossil | Este repositorio | AGPL-3.0 (generados desde el SVG con `tauri icon`) |
| `docs/screenshots/*` | Capturas de la app con datos de ejemplo | Contribuidores de Fossil | Este repositorio | AGPL-3.0 |

## Dependencias

Las bibliotecas de Rust y de JavaScript no se incluyen en el repositorio: se descargan al compilar,
según `Cargo.lock` y `pnpm-lock.yaml`, y cada una conserva su licencia. Las principales (Tauri,
React, TipTap, Yjs, yrs, rusqlite, tauri-specta) usan MIT o Apache-2.0, compatibles con AGPL-3.0.
Antes de añadir una dependencia nueva, confirma que su licencia sea compatible con AGPL-3.0.

## Marca

El nombre **Fossil** y su ícono identifican a este proyecto. Puedes usarlos para referirte a él; si
publicas una versión modificada, usa otro nombre y otro ícono para que nadie la confunda con la oficial.
