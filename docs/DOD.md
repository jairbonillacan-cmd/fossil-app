# Definition of Done

Un PR está listo para revisión solo si cumple **todo** lo siguiente. El revisor lo verifica punto por punto.

## Funcional
- [ ] Cumple todos los criterios de aceptación del issue.
- [ ] No mete nada fuera de alcance; lo extra va a un issue nuevo.
- [ ] Si tiene UI, el PR incluye captura o GIF, y funciona en tema claro y oscuro.

## Calidad
- [ ] `pnpm check` en verde (Biome, typecheck y Vitest).
- [ ] `cargo clippy --workspace -- -D warnings` y `cargo nextest run --workspace` en verde.
- [ ] Tiene tests nuevos para la lógica nueva. El código de core (Rust) siempre lleva tests unitarios.
- [ ] Ningún `unwrap()` / `expect()` en rutas de producción de Rust sin justificar en un comentario.
- [ ] No quedan `console.log`, código muerto ni TODOs sin issue asociado.

## Rendimiento (presupuestos)
| Métrica | Límite |
|---|---|
| Arranque en frío hasta la ventana interactiva | < 1.5 s |
| RAM en reposo (proceso + WebView2) | < 200 MB |
| Instalador base | < 30 MB |
| Búsqueda con 10 000 objetos | < 50 ms |
| CPU en reposo | ~0 % (sin polling) |

- [ ] El workflow `perf` no reporta regresiones mayores al 10 % sin justificar.

## Documentación
- [ ] `docs/modules/<area>.md` actualizado si cambió la estructura, un contrato o algo con trampa (gotcha).
- [ ] ADR nuevo si hubo una decisión de arquitectura.
- [ ] Textos de UI en el sistema i18n, nunca hardcodeados.

## Seguridad
- [ ] No hay secretos en el código ni en los logs.
- [ ] Toda superficie local (MCP, API, clipper) escucha solo en `127.0.0.1` y exige token.
- [ ] Las acciones de IA destructivas o externas piden confirmación.

## Proceso
- [ ] El PR dice `Closes #n` y la plantilla está completa.
- [ ] La rama está al día con `main` y el diff tiene ≤400 líneas, sin contar archivos generados.
