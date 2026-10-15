# Rendimiento

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión; los presupuestos son los de `DOD.md`

La ligereza es una función de Fossil, no una aspiración. Cada presupuesto se mide en CI y un PR que
lo rompa no entra.

## Presupuestos

| Métrica | Presupuesto | Último valor | Medido con | Cuándo |
|---|---:|---:|---|---|
| Instalador base (NSIS) | < 30 MB | 1.1 MB | `scripts/perf.ps1` | Línea base R0, 2026-10-14 |
| Arranque en frío hasta la ventana visible | < 1.5 s | 0.2–0.6 s | `scripts/perf.ps1` | Línea base R0 |
| RAM en reposo (proceso + WebView2) | < 200 MB | ~158 MB | `scripts/perf.ps1` | Línea base R0 |
| Búsqueda en 10 000 páginas | < 50 ms | sin medir | bench `search_10k` de `fossil-core` | En revisión |
| CPU en reposo | ~0 % (sin sondeos) | sin medir | Revisión de código | — |
| Tecleo en el editor, p95 con 5 000 bloques | < 16 ms | en el límite | Spike del editor (ADR-0015) | R1 |
| Captura rápida tras el atajo | < 300 ms | sin medir | — | R1 |

Los paquetes opcionales (análisis con DuckDB, voz) se descargan aparte y no cuentan en el instalador base.

## Cómo se mide

`scripts/perf.ps1` corre sobre un build de release (`pnpm build`) y escribe `perf-report.md`:

1. **Instalador:** tamaño del `.exe` NSIS en `target/release/bundle/nsis/`.
2. **Arranque en frío:** desde lanzar el proceso hasta que la ventana es visible.
3. **RAM en reposo:** *commit privado* del árbol de procesos (`fossil-desktop` y sus
   `msedgewebview2`), unos segundos después de abrir. Sumar *working set* contaría dos veces la
   memoria compartida entre procesos.

```powershell
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf.ps1
```

En CI, `.github/workflows/perf.yml` lo corre en cada PR que toca código, comenta la tabla en el PR y
falla si se pasa un presupuesto. No corre en PRs que solo tocan docs o `site/`.

## Reglas para no romperlos

- **Carga perezosa por módulo.** Lo que no se ve al abrir no se carga al abrir.
- **Nada de sondeos.** Eventos y suscripciones, no `setInterval` para revisar estado.
- **Listas virtualizadas** si pueden pasar de 200 elementos ([`DESIGN.md`](DESIGN.md)).
- **Trabajo pesado en Rust y fuera del hilo de la interfaz:** indexado, búsqueda, exportación.
- **Dependencias con presupuesto.** Una dependencia JS nueva dice en el PR cuánto suma al bundle.
- **Regresiones mayores al 10 %** en cualquier métrica se justifican en el PR o se corrigen.
