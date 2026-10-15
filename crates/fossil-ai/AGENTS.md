# AGENTS.md — crates/fossil-ai

Router de IA de Fossil: enruta cada tarea al mejor proveedor (clave de API, Ollama local o puente local vía `fossil-bridge`), con streaming, tool-calling y costos (`docs/ARCHITECTURE.md` § IA).

- Placeholder en R0; el spike de IA es #14 (R1) y el contrato #16.
- Las claves de API viven en el Administrador de credenciales de Windows (nunca en el repo ni en logs).
- **Nunca** leas ni reutilices credenciales de otros CLIs (ADR-0011); eso es territorio exclusivo de `fossil-bridge`.
- Hereda `[workspace.package]` y `[workspace.lints]`.
