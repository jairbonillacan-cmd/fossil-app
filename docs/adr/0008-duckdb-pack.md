# ADR-0008: DuckDB como "Pack Análisis" opcional

- **Estado:** aceptado (R5) · **Fecha:** 2026-10-13 · **Área:** `area:data`

## Decisión
- Las métricas y los dashboards de R5 usan **SQLite con modelos materializados**.
- **DuckDB** se distribuye como un pack descargable aparte, para datasets grandes (CSV, Excel, Parquet) y SQL analítico.
- Whisper (voz) sigue el mismo patrón de pack.

## Por qué
DuckDB pesa decenas de MB y rompería el presupuesto de < 30 MB del instalador. La mayoría de los usuarios no lo necesita desde el primer día.
