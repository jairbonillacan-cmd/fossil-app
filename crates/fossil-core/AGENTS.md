# AGENTS.md — crates/fossil-core

Núcleo de dominio de Fossil: objetos del grafo, tipos compartidos, CRDT (Yjs/yrs), SQLite e índices, queries y automatizaciones (`docs/ARCHITECTURE.md`).

- Placeholder en R0; la lógica de objetos llega con el contrato de R1 (#15) y siguientes.
- Todo cambio de tipos aquí es un contrato: abre un issue `type:contract` antes de modificarlo.
- Tests obligatorios (DoD); presupuesto: búsqueda < 50 ms con 10 000 objetos.
- Hereda `[workspace.package]` y `[workspace.lints]`; no agregues dependencias sin justificarlas en el PR.
