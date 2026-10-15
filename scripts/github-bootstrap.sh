#!/usr/bin/env bash
# Crea/actualiza labels y milestones del Protocolo Fossil (idempotente).
# Uso: bash scripts/github-bootstrap.sh   (requiere `gh auth login`)
set -euo pipefail
REPO="${REPO:-jairbonillacan-cmd/fossil-app}"

label() { gh label create "$1" --color "$2" --description "$3" --repo "$REPO" --force >/dev/null && echo "label $1"; }

# status
label "status:ready"        "0E8A16" "Listo para que un agente lo tome"
label "status:in-progress"  "FBCA04" "Reclamado por un agente"
label "status:handoff"      "D93F0B" "Interrumpido; ver comentario de handoff"
label "status:review"       "1D76DB" "PR listo para revisión"
label "status:blocked"      "B60205" "Bloqueado; ver comentario"
# type
label "type:feat"     "A2EEEF" "Funcionalidad"
label "type:bug"      "D73A4A" "Error"
label "type:contract" "5319E7" "Tipos/IPC/esquema; se mergea antes del trabajo en paralelo"
label "type:spike"    "C5DEF5" "Investigación con timebox"
label "type:docs"     "0075CA" "Documentación"
label "type:chore"    "EDEDED" "Mantenimiento, infra o trámite"
label "type:perf"     "F9D0C4" "Rendimiento"
# area
for a in editor objects storage views tasks content approvals commerce data ai mcp sync cloud portal os ui infra; do
  label "area:$a" "BFD4F2" "Área: $a"
done
# agent
for a in claude codex zcode antigravity antigravity-vision human; do
  label "agent:$a" "E4E669" "Trabajado por: $a"
done
# size
label "size:S" "C2E0C6" "Menos de medio día"
label "size:M" "FEF2C0" "1–2 días"
# lanes y colas (ADR-0014)
for l in core infra shell editor bugs; do
  label "lane:$l" "1D76DB" "Carril: $l"
done
label "needs:code-review" "FBCA04" "Cola de revisión de código"
label "needs:vision"      "C5DEF5" "Cola de revisión visual"
label "cross-lane"        "D93F0B" "Cruce de carril autorizado por el orquestador"
label "fix:main"          "B60205" "Arregla main en rojo; puede mergear durante el freeze"

milestone() {
  local title="$1" desc="$2"
  if gh api "repos/$REPO/milestones?state=all&per_page=100" --jq '.[].title' | grep -qx "$title"; then
    echo "milestone $title (ya existe)"
  else
    gh api "repos/$REPO/milestones" -f title="$title" -f description="$desc" >/dev/null && echo "milestone $title"
  fi
}
milestone "R0 Fundaciones"       "Monorepo, CI/perf, Tauri hola mundo con instalador NSIS, design tokens. Spec: docs/specs/r0-foundations.md"
milestone "R1 Bóveda"            "Core de objetos + editor + journals + búsqueda + Ctrl+K + IA (router + puente de suscripciones). Listo: el PO usa Fossil a diario."
milestone "R2 Tipos y tareas"    "Tipos, vistas, tareas, recordatorios, MCP servidor/cliente, agente con herramientas."
milestone "R3 Equipo"            "Supabase + Hocuspocus, cuentas, roles, presencia, comentarios, historial. v0.3."
milestone "R4 Contenido"         "Marca, campañas, posts, previews, parrillas, aprobaciones, portal de cliente, DAM."
milestone "R5 Comercio y datos"  "Shopify/ads/GA4, Resumen, Rentabilidad, atribución v1, Creativos, cohortes, KPIs, reportes, agente analista."
milestone "R6 Publicación"       "Auto-publicación, mejor hora, inbox, enlaces con seguimiento."
milestone "R7 v1.0"              "Firma, auto-update, onboarding, E2EE, plugins, voz, rendimiento."
milestone "Futuro"               "Diferidos explícitos (docs/MILESTONES.md)."
