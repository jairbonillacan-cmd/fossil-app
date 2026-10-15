# ADR-0009: GitHub Issues como fuente única de verdad del trabajo

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:infra`

## Contexto
Varios agentes distintos (Claude Code, Codex, ZCode, Antigravity) trabajan en paralelo, a veces desde máquinas distintas. Necesitan saber qué hacer, qué está tomado y qué dejaron otros, sin gastar tokens explorando.

## Decisión
**GitHub Issues + Milestones + labels + `gh` CLI.**
- **Reclamar** un issue = cambiar sus labels + dejar un comentario.
- **Handoff:** en comentarios del issue y en la plantilla del PR.
- **Memoria de largo plazo:** en el repo (specs, ADRs y mapas de módulo).

## Alternativas
- **Backlog.md:** las tareas son archivos del repo; con agentes en paralelo y en ramas distintas generan conflictos, y no hay forma de reclamar una tarea.
- **Beads:** depende de Dolt y de un daemon, y tiene problemas con worktrees.
- **Archivos STATUS.md / HANDOFF.md:** conflictos de merge y estado desactualizado.

## Consecuencias
- El trabajo es visible en un solo lugar y desde cualquier máquina, y el PO lo ve en el tablero.
- Desde R2, el servidor MCP de Fossil puede exponer las specs a los agentes.
