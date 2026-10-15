# AGENTS.md — crates/fossil-mcp

Servidor y cliente MCP de Fossil (sobre `rmcp`): expone herramientas de Fossil a agentes externos y consume servidores MCP de terceros.

- Placeholder en R0.
- Toda superficie local escucha **solo en 127.0.0.1** y exige token de sesión (DoD §Seguridad).
- Las acciones destructivas o externas que lleguen por MCP piden confirmación en la UI.
- Hereda `[workspace.package]` y `[workspace.lints]`.
