# AGENTS.md — crates/fossil-data

Capa de datos de Fossil: ingesta de fuentes externas (métricas, e-commerce), modelos materializados y datasets para análisis; DuckDB como pack opcional (`docs/FEATURES.md` §13, ADR-0008).

- Placeholder en R0.
- Los datasets grandes nunca se cargan completos en memoria: streaming y presupuestos del DoD.
- Hereda `[workspace.package]` y `[workspace.lints]`.
