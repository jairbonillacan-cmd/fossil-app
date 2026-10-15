# ADR-0002: React 19 + TypeScript + Vite para la UI

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:ui`

## Decisión
- **Base:** React 19, TypeScript estricto y Vite.
- **Estilos y componentes:** Tailwind v4 con Radix/shadcn.
- **Librerías:** TanStack Router, Query, Virtual y Table; Zustand para el estado local de la UI.
- **Lint y formato:** Biome.
- **Carga:** code-splitting por módulo con `React.lazy`.

## Por qué
- Es el ecosistema que mejor conocen todos los agentes (Claude, Codex, Gemini, GLM).
- Tiene el mayor ecosistema de editores (TipTap), vistas y gráficas.
- La carga perezosa mantiene pequeño el bundle inicial.

## Alternativas
- **SolidJS / Svelte:** algo más rápidos, pero con menos ecosistema y más errores de los agentes.
- **ESLint + Prettier:** más lentos y con más configuración que Biome.
