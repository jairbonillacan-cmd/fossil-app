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
2. **CHANGELOG.** Mueve "Sin publicar" a `## <versión> · <AAAA-MM-DD>`. Una línea por cambio, desde
   el punto de vista de quien usa Fossil; las reglas están al inicio del archivo.
3. **ROADMAP.** Mueve lo publicado de "En curso" a "Lanzado", con `<versión> · <AAAA-MM>`.
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

## Firma y actualizaciones

Los instaladores aún **no están firmados**: Windows SmartScreen pide confirmación al instalar. La
firma de código y las actualizaciones automáticas (canales estable y beta) llegan en R7
([`MILESTONES.md`](MILESTONES.md)). Hasta entonces, cada versión se instala a mano.

## Si algo sale mal

- **El build del tag falla:** corrige en `main` con un PR, borra la etiqueta
  (`git push origin :refs/tags/vX`) y vuelve al paso 6 con el commit nuevo.
- **Un error grave después de publicar:** retira el release (vuelve a borrador) y publica un parche.
  Nunca reutilices un número de versión.
