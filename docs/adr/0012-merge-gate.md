# ADR-0012: Merge gate por script (protección de main sin GitHub Pro)

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:infra`

## Contexto
Queremos que nada llegue a `main` sin CI verde y sin la revisión visual de los PRs con UI . La herramienta natural es la protección de ramas de GitHub con un status check obligatorio, pero la API la rechaza con 403 en repos privados del plan Free; requiere GitHub Pro.

## Decisión
Todas los merges pasan por **`scripts/merge.ps1 <pr>`** (este repo), que hace squash-merge **solo si**:
1. `gh pr checks <pr>` está totalmente en verde (exige al menos un check: `ci.yml` corre en cada PR),
2. el PR **no** tiene el label `needs:vision` (cola de la revisión visual; el revisor no se activa solo — el PO abre la sesión), y
3. si el PR cambia archivos **visuales** (`apps/desktop/src/**`, `packages/ui/**`, `docs/screenshots/**`, `*.css`), el último veredicto de `zcode-vision` es **"Veredicto: OK"** y ningún commit **autoreado** después de ese OK toca archivos visuales. Los rebases preservan la fecha de autor, así que un rebase (o un commit no visual) no invalida un OK; sí lo invalida un cambio visual nuevo.
   - **Excepción:** `apps/desktop/src/bindings.ts` no es visual: es salida de codegen de `tauri-specta` (drift verificado por `ci.yml`) y no afecta nada renderizado. Un PR que solo lo regenera no necesita veredicto.

Tras mergear, el script limpia los labels `status:*` del issue que cierra el PR. El paso 9 de `AGENTS.md` referencia este script y los agentes lo usan obligatoriamente. Al abrir un PR con cambios visuales, el constructor añade `needs:vision` y lo quita el revisor/orquestador cuando llega el veredicto.

## Consecuencias
- La disciplina vive en los agentes y en el script, no en GitHub: un humano con permisos aún podría saltársela desde la web.
- El gate es auditable (el script imprime el motivo del rechazo) y local a cada checkout.
- Si el PO contrata GitHub Pro, se activa la protección nativa (status check `ci` obligatorio, sin reviews, `enforce_admins: false`) y este script queda como doble chequeo, no se elimina.

## Revisión 2026-10-14: gate v2, parte 1 (#59)
El gate fallaba **abierto**: una "Revisión de código" con `Veredicto: OK` contaba como OK visual, y un error de la API se tomaba como "sin archivos visuales". Ahora:
- **Falla cerrado.** Cualquier `gh` con exit ≠ 0, una salida vacía, un JSON inválido o un campo que falta → RECHAZADO (un `trap` convierte cualquier error en rechazo).
- **Identidad por encabezado.** Todos los agentes comentan desde la misma cuenta, así que el login no sirve:
  - solo cuenta como visual un comentario cuya primera línea es `## Revisión visual (antigravity-vision|zcode-vision|claude-vision, …)`;
  - como revisión de código, `## Revisión de código (<agente>, …)`.
- **Revisión de código obligatoria**, de un agente distinto al de la línea `**Agente:** <id>` del PR. Un commit **autoreado** después del OK la invalida.
- **El PR debe estar al día** con la base (`compare` con `behind_by == 0`), y el check `ci` debe estar en verde de forma explícita.
- **Freeze:** si el último run terminado de `ci.yml` en `main` falló, solo entran PRs con el label `fix:main`.
- **Higiene:**
  - se rechaza un PR en draft o sin `Closes #n` / `Parte de #n`;
  - el merge usa `--match-head-commit` para que nadie empuje entre la verificación y el merge;
  - `-DryRun` verifica sin mergear.
- **Tests sin red** en `scripts/tests/merge-gate.tests.ps1`, ejecutados como paso del job `ci`.

## Revisión 2026-10-14: PR atrasado sin solape (decisión del PO)
Con un CI de ~13 min por corrida, exigir el PR al día con `main` obligaba a rebasar y volver a correr CI tras cada merge. Ahora un PR **atrasado** entra solo si los commits que llegaron a `main` desde que se ramificó **no tocan ninguno de sus archivos ni archivos compartidos** (lockfiles, `Cargo.toml`, `package.json`, `pnpm-workspace.yaml`, `rust-toolchain.toml`, `bindings.ts`, `lib.rs`, `tauri.conf.json`, migraciones y workflows), y si `main` está en verde. Si la combinación rompe algo, el CI de `main` lo detecta y la regla de freeze congela los merges hasta el `fix:main`. Más de 300 archivos de deriva o una respuesta sin lista de archivos → rebase obligatorio (falla cerrado).

## Revisión 2026-10-14: gate v2, parte 2 (#72)
- **Carriles:** cada archivo debe estar en el carril del autor (`.github/lanes.json`) y no ser caliente. Si no, hace falta el label `cross-lane`, que pone el orquestador tras revisar (ADR-0014). Los generados no cuentan.
- **Tamaño:** máximo 400 líneas agregadas sin contar los generados.
- **Tests no visuales:** `*.test.ts` y `*.test.tsx` ya no exigen revisión visual.
- **Huella** (`scripts/pr-fingerprint.ps1 <pr> [-Visual]`): sha256 de `ruta blob-sha` de los archivos del PR. Si una revisión trae `Huella:` (o `Huella visual:`), vale mientras el contenido revisado no cambie, aunque haya rebases o commits nuevos sin cambios. Si no coincide, se rechaza. Sin huella sigue valiendo la regla de fechas de autor.

## Revisión 2026-10-14: identidad completa (ADR-0016)
- **PRs:** el cuerpo debe tener `**Harness:**` y `**Modelo:**` además de `**Agente:**`. Un placeholder `<!-- -->` no cuenta.
- **Revisiones:** las publicadas desde el 2026-10-15 00:00 UTC deben firmar `(<agente>, <harness>, <modelo>)`. Una mal firmada **rechaza** el merge en lugar de ignorarse, para que un `CAMBIOS` mal escrito no deje pasar un OK anterior.
- El rol sigue saliendo solo del id: el modelo puede cambiar (por ejemplo, Gemini 3.8 Flash como `antigravity-vision`).
- El mensaje de OK nombra al autor y a los revisores con su harness y modelo.

## Alternativas consideradas
- **Rulesets**: también API restringida en Free para repos privados.
- **No mergear desde agentes** (solo el PO): rompe la autonomía del protocolo.
