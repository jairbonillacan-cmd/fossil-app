# Rendimiento

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** corridas repetidas con percentiles, corpus determinista y JSON estable en `perf.ps1` (#78)

La ligereza es una función de Fossil, no una aspiración. Cada presupuesto se mide en CI y un PR que
lo rompa no entra.

## Presupuestos

| Métrica | Presupuesto | Último valor | Medido con | Cuándo |
|---|---:|---:|---|---|
| Instalador base (NSIS) | < 30 MB | 1.1 MB | `scripts/perf.ps1` | Línea base R0, 2026-10-14 |
| Arranque en frío hasta la ventana visible | < 1.5 s | 0.2–0.6 s | `scripts/perf.ps1` | Línea base R0 |
| RAM en reposo (proceso + WebView2) | < 200 MB | ~158 MB | `scripts/perf.ps1` | Línea base R0 |
| Búsqueda en 10 000 páginas | < 50 ms | 5.7 ms (mediana) | bench `search_10k` de `fossil-core` | #78, 2026-10-15 |
| CPU en reposo | ~0 % (sin sondeos) | sin medir | Revisión de código | — |
| Tecleo en el editor, p95 con 5 000 bloques | < 16 ms | en el límite | Spike del editor (ADR-0015) | R1 |
| Captura rápida tras el atajo | < 300 ms | sin medir | — | R1 |

Los paquetes opcionales (análisis con DuckDB, voz) se descargan aparte y no cuentan en el instalador base.

## Cómo se mide

`scripts/perf.ps1` corre sobre un build de release (`pnpm build`) y escribe `perf-report.md` y
`perf-report.json`:

1. **Instalador:** tamaño del `.exe` NSIS en `target/release/bundle/nsis/`.
2. **Arranque en frío y en caliente, con `-Runs <N>`** (5 por defecto): el primer lanzamiento de la
   corrida cuenta como frío —equivale a la medición única que hacía el script antes— y los `N-1`
   siguientes, con las cachés del sistema ya tibias, como calientes. Sin permisos de administrador
   no se puede vaciar la caché de disco: el "frío" es una aproximación, pero igual en todas las
   corridas y comparables entre sí.
3. **RAM en reposo:** *commit privado* del árbol de procesos (`fossil-desktop` y sus
   `msedgewebview2`), tres segundos después de cada arranque. Sumar *working set* contaría dos veces
   la memoria compartida entre procesos.
4. **Escenarios de biblioteca, optativos con `-Bench`:** corre los benches de criterion de
   `fossil-core` con `--quick` (búsqueda en 10 000 páginas, importación del corpus de 1 000 páginas
   y carga/indexado del documento de 5 000 bloques) y copia su mediana al reporte. Necesita `cargo`
   en el PATH; la primera vez tarda unos minutos por la compilación.

Cada métrica se reporta como **p50, p95 y máximo** de sus repeticiones (percentil de rango cercano;
con 5 muestras el p95 cae en el máximo). Los presupuestos se evalúan contra el p50, salvo la
búsqueda en 10 000, que el propio bench assertea en p95 (< 50 ms). El reporte declara el
**hardware** de la corrida vía CIM/WMI —CPU, núcleos físicos/lógicos, RAM total, tipo de disco y
versión de Windows— porque sin ese contexto los números no comparan entre máquinas. El scroll del
documento de 5 000 bloques en la interfaz sigue pendiente: requiere la app abierta y automatización
de UI (issue #78); el script no inventa ese número.

`perf-report.json` tiene claves fijas y ordenadas (`schema_version: 1`): `.github/workflows/perf.yml`
lo sube como artefacto en cada corrida y en cada PR lo compara contra la última corrida de `main`
(tabla de deltas p50 en el comentario). Los umbrales son los de siempre: instalador < 30 MB,
arranque < 1.5 s, RAM < 200 MB, búsqueda en 10k < 50 ms.

```powershell
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf.ps1          # 1 arranque frío + 4 calientes
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf.ps1 -Bench   # añade búsqueda, importación y doc 5k
```

## Corpus determinista

Los benches de `fossil-core` comparten un corpus con semilla fija
(`crates/fossil-core/benches/corpus/`): 1 000 y 10 000 páginas, más un documento de 5 000 bloques,
todo contenido genérico (Acme, "Mi equipo"). La misma semilla produce los mismos bytes: lo verifica
`cargo nextest run -p fossil-core --test corpus_determinism` y, a mano, el generador escribe el
corpus a disco para comparar hashes:

```powershell
cargo run -p fossil-core --example corpus -- --out corpus
Get-FileHash corpus\* -Algorithm SHA256   # corre dos veces y compara
```

## Reglas para no romperlos

- **Carga perezosa por módulo.** Lo que no se ve al abrir no se carga al abrir.
- **Nada de sondeos.** Eventos y suscripciones, no `setInterval` para revisar estado.
- **Listas virtualizadas** si pueden pasar de 200 elementos ([`DESIGN.md`](DESIGN.md)).
- **Trabajo pesado en Rust y fuera del hilo de la interfaz:** indexado, búsqueda, exportación.
- **Dependencias con presupuesto.** Una dependencia JS nueva dice en el PR cuánto suma al bundle.
- **Regresiones mayores al 10 %** en cualquier métrica se justifican en el PR o se corrigen.
