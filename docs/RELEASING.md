# Publicar una versión

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión

## Versiones

`MAYOR.MENOR.PARCHE` con sufijo de etapa mientras no haya v1.0: `0.1.1-alpha.2`.

| Parte | Sube cuando |
|---|---|
| Menor (`0.x`) | Se cierra un release (`R1` → `0.2`, …, `R7` → `1.0`) |
| Parche (`0.1.x`) | Una versión intermedia con mejoras o arreglos |
| Sufijo (`-alpha.n`, `-beta.n`) | Cada versión publicada dentro de la etapa |

El sufijo solo va en la etiqueta y en `CHANGELOG.md`; los archivos llevan `MAYOR.MENOR.PARCHE`
(por ejemplo `0.1.1`). La versión vive en tres archivos y cambia en un solo PR `chore(release)`:
`Cargo.toml` (`[workspace.package] version`), `apps/desktop/package.json` y
`apps/desktop/src-tauri/tauri.conf.json`. `Cargo.lock` se regenera con `cargo update -w`.

## Pasos

1. **`main` en verde** y todo lo que entra en la versión, mergeado.
2. **CHANGELOG.** Mueve "Sin publicar" a `## <versión> · <AAAA-MM-DD>` y deja "Sin publicar" vacío
   arriba. Una línea por cambio, desde el punto de vista de quien usa Fossil; las reglas están al
   inicio del archivo. Entra solo lo ya mergeado en `main`: lo que sigue en revisión espera a la
   siguiente versión.
3. **ROADMAP.** Mueve lo publicado de "En curso" a "Lanzado", con `<versión> · <AAAA-MM>`. Quita la nota "falta publicarla" de lo que
   ya salió.
4. **STATUS.** Actualiza la versión, los números y la tabla por área de [`STATUS.md`](STATUS.md).
5. **PR `chore(release): version X.Y.Z`** con los tres archivos de versión, `Cargo.lock`, el
   changelog, el roadmap y el estado. Se mergea como cualquier PR.
6. **Etiqueta** el commit de `main`:

   ```powershell
   git tag v0.1.2-alpha.3
   git push origin v0.1.2-alpha.3
   ```

7. **CI** (`.github/workflows/release.yml`) compila el instalador NSIS con `tauri-action` y crea un
   release en **borrador** con el instalador adjunto.
8. **Prueba el instalador** en una máquina limpia de Windows 11: instala, abre un Espacio, escribe,
   cierra y reabre.
9. **Publica** el borrador en GitHub. El sitio público lee `CHANGELOG.md` y `ROADMAP.md` de `main`
   y se actualiza solo después del merge del paso 5.

## Qué está en main, en revisión y publicado

| Estado | Dónde se ve |
|---|---|
| En revisión | PR abierto, label `status:review`. No aparece en `CHANGELOG.md` |
| En `main` | Línea en `## Sin publicar` de `CHANGELOG.md`; el elemento sigue en "En curso" del `ROADMAP.md` |
| Publicado | Sección `## <versión>` de `CHANGELOG.md` y "Lanzado" en `ROADMAP.md`, con la etiqueta `v<versión>` |

La siguiente versión se prepara siempre con lo que ya está en `main`; la persona dueña del producto
decide al instalarla si se publica. `scripts/check-release-trace.ps1` (paso del job `ci`) falla si
una versión con etiqueta tiene una sección distinta a la de su etiqueta, es decir, si menciona algo
que no está en lo que se publicó, o si "Sin publicar" deja de ir primero.

## Firma y actualizaciones

Los instaladores aún **no están firmados**: Windows SmartScreen pide confirmación al instalar. La
firma de código y las actualizaciones automáticas (canales estable y beta) llegan en R7
([`MILESTONES.md`](MILESTONES.md)). Hasta entonces, cada versión se instala a mano.

## Checklist de release

Antes de etiquetar y publicar una versión, verifica cada punto:

- [ ] **CI y pruebas en verde en `main`:** `pnpm check`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` y `cargo nextest run --workspace`.
- [ ] **Flujos de extremo a extremo (`e2e`):** `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e.ps1` en verde (crear página, enlace `[[ ]]`, panel **Enlazada desde** y búsqueda).
- [ ] **Contrato e higiene:** `git diff --exit-code -- apps/desktop/src/bindings.ts` sin diferencias y `scripts/check-denylist.ps1` en verde.
- [ ] **Presupuestos de rendimiento (`scripts/perf.ps1`):** instalador NSIS < 30 MB, arranque en frío < 1.5 s, RAM en reposo < 200 MB y búsqueda en 10 000 páginas < 50 ms.
- [ ] **Versión sincronizada:** `Cargo.toml`, `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json` y `Cargo.lock` actualizados en el PR `chore(release)`.
- [ ] **"Sin publicar" movido a la versión:** `CHANGELOG.md` tiene la sección `## <versión> · <AAAA-MM-DD>` con las líneas de "Sin publicar" (que queda vacío) y `scripts/check-release-trace.ps1` pasa.
- [ ] **ROADMAP al día:** los elementos publicados pasaron de "En curso" a "Lanzado" con `<versión> · <AAAA-MM>`.
- [ ] **Solo lo terminado:** la versión incluye únicamente lo mergeado en `main`; nada en revisión ni en una rama.
- [ ] **Notas y estado público:** `CHANGELOG.md`, `ROADMAP.md` y `docs/STATUS.md` al día (sin números de issue internos ni nombres de terceros en archivos públicos).
- [ ] **Prueba en máquina limpia (Windows 11):** instalar el `.exe` generado en CI, crear un Espacio, crear una página, enlazar con `[[ ]]`, revisar **Enlazada desde**, buscar, cerrar y reabrir sin pérdida de datos.

## Si algo sale mal

- **El build del tag falla:** corrige en `main` con un PR, borra la etiqueta
  (`git push origin :refs/tags/vX`) y vuelve al paso 6 con el commit nuevo.
- **Un error grave después de publicar:** retira el release (vuelve a borrador) y publica un parche.
  Nunca reutilices un número de versión.
