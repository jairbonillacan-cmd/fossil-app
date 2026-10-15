# AGENTS.md — crates/fossil-bridge

Puente de agentes locales de Fossil: ejecuta los CLIs oficiales ya logueados (`agy`, `claude`, `codex`) como procesos hijo en modo headless o ACP (`docs/ARCHITECTURE.md` § IA).

- Placeholder en R0; el spike del puente es #14 (R1) y la implementación #33.
- **Regla dura (ADR-0011):** nunca leer, copiar ni reutilizar credenciales/tokens de otros CLIs; solo ejecutar el binario oficial.
- Cada llamada corre en un directorio temporal, con timeout y cancelación; la bóveda solo se expone vía MCP.
- Hereda `[workspace.package]` y `[workspace.lints]`.
