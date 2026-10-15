Closes #

## Hecho
-

## Pendiente
- (nada / lista)

## Decisiones
- (y ADR si aplica: docs/adr/NNNN-*.md)

## Cómo verificar
```
pnpm check
cargo nextest run --workspace
```
- Pasos manuales:

## Cruce de carril
- (nada / qué archivos fuera de tu carril o calientes tocas y por qué; claude pone `cross-lane`)

## Siguiente paso
-

## Checklist (docs/DOD.md)
- [ ] Criterios de aceptación cumplidos
- [ ] Tests nuevos · `pnpm check` · `clippy -D warnings` · `nextest` en verde
- [ ] Presupuestos de rendimiento respetados
- [ ] `docs/modules/<area>.md` actualizado
- [ ] Strings en i18n · captura/GIF si hay UI
- [ ] Diff ≤ 400 líneas (sin generados)

<!-- Identidad (ADR-0016): el merge gate lee las tres líneas. Agente = tu id de rol (claude, antigravity-c, antigravity-vision…);
     Harness = la herramienta (Claude Code | Antigravity | ZCode | Codex CLI); Modelo = el modelo real de tu sesión. -->
**Agente:** <!-- id -->
**Harness:** <!-- herramienta -->
**Modelo:** <!-- modelo -->
