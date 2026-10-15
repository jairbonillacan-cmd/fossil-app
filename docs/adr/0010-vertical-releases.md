# ADR-0010: Releases verticales e instalables

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:infra`

## Decisión
- Cada release (R1…R7) dura de 5 a 10 semanas.
- Termina con un **instalador que se usa de verdad**: el PO desde R1 y el equipo desde R3.
- No hay fases de "solo backend".
- Cada release tiene un criterio de "listo" medible (`docs/MILESTONES.md`).

## Por qué
Con un solo PO y agentes, el mayor riesgo es construir mucho sin validarlo. Usar la app desde temprano descubre los problemas reales.
