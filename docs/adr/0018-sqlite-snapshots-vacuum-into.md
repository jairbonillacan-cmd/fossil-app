# ADR-0018: Snapshots de SQLite con `VACUUM INTO` y `PRAGMA quick_check`

- **Estado:** aceptado
- **Fecha:** 2026-10-16
- **Área:** `area:storage`
- **Relacionado:** `docs/specs/r1-trust.md`, ADR-0004 (SQLite + Copia en Markdown), `docs/modules/storage.md`

## Contexto
La spec `r1-trust` exige respaldos del **Espacio** que se puedan restaurar sin corrupción. La base
`.fossil/fossil.db` está en WAL y recibe escrituras en cualquier momento (`object_apply_update`,
compactación, índice). Copiar el archivo con `std::fs::copy` en caliente puede dejar una base partida:
el `.db` sin las páginas que aún viven en `-wal`, o una página escrita a medias. Tampoco queremos que
el respaldo tome el `Mutex` de `VaultSession`, porque congelaría el editor mientras dura.

## Decisión
1. El snapshot de SQLite se genera **solo** con `VACUUM INTO '<destino>/fossil.db'`, ejecutado sobre
   una **conexión propia de solo lectura** (`SQLITE_OPEN_READ_ONLY`) a la base en WAL. Nunca con
   `std::fs::copy`, nunca sobre la conexión de `VaultSession`.
2. Antes de sellar el respaldo, se abre el `fossil.db` generado y se corre `PRAGMA quick_check`. Si no
   devuelve `ok`, el snapshot se registra con `integrity_ok = 0` y no se ofrece para restaurar.
3. Antes de activar una restauración del **Espacio** completo se corre `PRAGMA integrity_check`
   (más lento y completo) sobre la base del snapshot.
4. El resto del snapshot (`vault.json`, `mirror.json`, `attachments/`) se copia con archivo temporal
   y `rename`, y `manifest.json` guarda el SHA-256 de cada archivo.

## Consecuencias
- WAL permite que la conexión de lectura vea una foto consistente mientras la app sigue escribiendo:
  `VACUUM INTO` corre en una transacción de lectura y no bloquea a los escritores.
- El destino sale compactado y sin `-wal`, así que un snapshot es un solo archivo autocontenido.
- `VACUUM INTO` falla si el destino ya existe: cada snapshot va en una carpeta nueva
  (`.fossil/backups/<snapshot_id>/`), lo que también evita sobrescribir respaldos.
- Coste: lee la base completa en cada snapshot. Aceptable con la retención rotativa (10 diarios,
  4 semanales); si una base grande lo vuelve lento, medir antes de cambiar de mecanismo.
- `quick_check` no verifica índices contra tablas; por eso la restauración usa `integrity_check`.

## Alternativas consideradas
- `std::fs::copy` del `.db` y el `-wal`: no es atómico frente a escrituras concurrentes; prohibido.
- API de backup en línea de SQLite (`sqlite3_backup_*`): consistente, pero reinicia la copia cuando
  otra conexión escribe y copia también páginas libres. `VACUUM INTO` es una sola sentencia SQL.
- Copiar después de `PRAGMA wal_checkpoint(TRUNCATE)`: exige bloquear escritores durante la copia.
