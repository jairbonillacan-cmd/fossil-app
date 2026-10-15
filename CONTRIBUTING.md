# Contribuir a Fossil

Gracias por tu interés. Esta guía explica cómo llevar un cambio de la idea al merge. Si eres un
agente de IA, lee además [`AGENTS.md`](AGENTS.md).

## Antes de escribir código

- **Errores:** busca si ya hay un issue; si no, abre uno con la plantilla *Bug* ([`SUPPORT.md`](SUPPORT.md)
  dice qué incluir).
- **Funciones nuevas:** abre primero un issue con la plantilla *Feature*. Revisa que la función quepa
  en [`docs/FEATURES.md`](docs/FEATURES.md) y en el release que le toca ([`docs/MILESTONES.md`](docs/MILESTONES.md)).
  Un PR grande que nadie pidió es difícil de aceptar, aunque esté bien hecho.
- **Cambios de contrato** (tipos de `fossil-core`, comandos IPC, esquema SQLite): siempre en un issue
  `type:contract` aparte, que se mergea antes del trabajo que lo usa.
- **Decisiones de arquitectura:** van en un ADR (`docs/adr/NNNN-*.md`, plantilla en `0000-template.md`).

## Preparar el entorno

Sigue [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). En resumen: Windows 11, Rust (MSVC), Visual
Studio Build Tools con C++, Node.js 22+ y pnpm; luego `pnpm install` y `pnpm dev`.

## Hacer el cambio

1. Crea una rama desde `main`: `<tu-usuario>/<issue>-<descripcion-corta>`.
2. Commits pequeños en formato [Conventional Commits](https://www.conventionalcommits.org/es/):
   `feat(editor): …`, `fix(core): …`, `docs: …`. Mensajes en inglés.
3. Incluye tests para la lógica nueva ([`docs/TESTING.md`](docs/TESTING.md)). El código de Rust del
   núcleo siempre lleva tests unitarios.
4. Textos de interfaz en `apps/desktop/src/i18n/` (es-MX y en), nunca en el código. Los nombres
   visibles salen de [`docs/GLOSSARY.md`](docs/GLOSSARY.md).
5. Si tocas la interfaz, verifica en tema claro y oscuro y adjunta capturas al PR.
6. Actualiza el `docs/modules/<área>.md` que corresponda si cambiaste un contrato o descubriste una trampa.
7. Si la persona usuaria va a notar el cambio, añade una línea en `CHANGELOG.md` bajo **Sin publicar**,
   siguiendo las reglas del comentario al inicio del archivo.

## Abrir el PR

- Un PR resuelve un issue y agrega **400 líneas o menos**, sin contar archivos generados. Si crece, divídelo.
- Usa la plantilla: qué hiciste, qué falta, decisiones, cómo verificarlo.
- Corre antes lo mismo que CI:

  ```powershell
  pnpm.cmd check
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo nextest run --workspace
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-denylist.ps1
  ```

- Cumple el checklist de [`docs/DOD.md`](docs/DOD.md). El revisor lo verifica punto por punto.

## Revisión

Revisa otra persona o agente, nunca quien escribió el cambio. Un PR con interfaz necesita además una
revisión visual. El merge lo hace el mantenedor, de uno en uno, con `scripts/merge.ps1`: exige CI en
verde, la rama al día con `main` y las revisiones aprobadas. Si te pide rebase:
`git rebase origin/main` y `git push --force-with-lease`.

## Reglas que no se negocian

- **Nada de datos reales.** Ni nombres de clientes o empresas, ni rutas o datos personales, en código,
  tests, fixtures, capturas o docs. Usa Acme y "Mi equipo". CI lo revisa.
- **Nada de nombres de otros productos** ni comparaciones con ellos. Las integraciones (Shopify, GA4,
  Meta Ads…) sí se nombran.
- **Nada de secretos.** Ninguna clave, token ni credencial en el repo o en los logs.
- **No copies código, textos, íconos ni diseños** de software que no tenga una licencia compatible.
  Los recursos de terceros llevan su licencia junto al archivo y una fila en [`ATTRIBUTION.md`](ATTRIBUTION.md).
- **Presupuestos de rendimiento** ([`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)): un PR que los rompa no entra.

## Licencia de tus contribuciones

Fossil se publica bajo la licencia AGPL-3.0-or-later. Al enviar un PR aceptas que tu contribución se publique
bajo esa misma licencia, y certificas que tienes derecho a hacerlo según el
[Developer Certificate of Origin](https://developercertificate.org/). Firma cada commit con
`git commit -s`, que añade la línea `Signed-off-by: Tu Nombre <tu@correo>`.

## Conducta

Este proyecto sigue un [código de conducta](CODE_OF_CONDUCT.md). Al participar, te comprometes a respetarlo.
