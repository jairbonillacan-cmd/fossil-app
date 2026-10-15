# ADR-0007: Dos modos de Space (gestionado y privado E2EE)

- **Estado:** aceptado · **Fecha:** 2026-10-13 · **Área:** `area:sync`

## Decisión
- **Equipo gestionado** (modo por defecto, R3): el servidor puede leer el contenido. Es necesario para:
  - publicar;
  - el portal de clientes;
  - las alertas;
  - los reportes programados;
  - los conectores.
- **Privado E2EE** (R7):
  - el servidor solo guarda blobs cifrados (XChaCha20-Poly1305);
  - frase de recuperación y desbloqueo con Windows Hello;
  - sin funciones de servidor.

## Por qué
El cifrado de extremo a extremo es incompatible con que el servidor procese el contenido. Separarlo por Space deja la elección al usuario.
