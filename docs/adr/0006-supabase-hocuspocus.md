# ADR-0006: Cloud con Supabase + Hocuspocus + worker

- **Estado:** aceptado (se implementa en R3) · **Fecha:** 2026-10-13 · **Área:** `area:cloud`

## Decisión
- **Supabase:**
  - Auth (magic link y Google);
  - Postgres con RLS;
  - Storage para adjuntos;
  - cron.
- **Hocuspocus** (MIT, de Tiptap): servidor de sync Yjs. Autentica con el JWT de Supabase y persiste en Postgres.
- **Worker:** jobs de publicación, recordatorios, conectores, alertas y reportes. Corre en un VPS barato (Hetzner o Fly).

## Por qué
Construir auth, almacenamiento y un servidor CRDT desde cero costaría meses. Estas piezas son abiertas, probadas y baratas (unos $45–60 USD al mes). Si hiciera falta, Supabase se puede autoalojar.

## Consecuencias
- Parte del backend queda en TypeScript (Hocuspocus y el worker); se acepta por realismo.
- Antes de R3 se hace un spike para validar Hocuspocus con el JWT de Supabase y los permisos por Space.
