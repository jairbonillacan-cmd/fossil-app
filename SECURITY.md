# Política de seguridad

Fossil guarda el trabajo de equipos en la computadora de cada persona, lee archivos de esa
computadora, guarda claves de API y, a partir de R2, expone un servidor MCP local. Tratamos como
hostil todo lo que entra por archivos, IPC, MCP o la red.

## Reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de vulnerabilidades de GitHub: pestaña
*Security* del repositorio → *Report a vulnerability*. Si no puedes usarlo, escribe por el canal
privado indicado en [`SUPPORT.md`](SUPPORT.md) y pide un medio seguro antes de mandar detalles.

Incluye:

- versión de Fossil (o commit) y versión de Windows;
- el componente afectado (por ejemplo `fossil-core::attachments`, un comando IPC, el puente de IA);
- el impacto y qué acceso necesita quien ataca;
- pasos exactos para reproducirlo, y qué esperabas que pasara;
- si tienes un archivo que lo provoca, su tipo, tamaño y hash; mándalo solo por el canal privado.

Quita de tus logs claves, rutas personales y contenido privado.

## Qué esperar

| Paso | Plazo objetivo |
|---|---|
| Acuse de recibo | 3 días hábiles |
| Primera evaluación (¿es válido?, ¿qué tan grave?) | 10 días hábiles |
| Corrección publicada para un fallo crítico o alto | 30 días |

Coordinamos contigo la fecha de divulgación y te damos crédito en el aviso si lo deseas.

## Versiones con soporte

Fossil está en alpha: solo la versión más reciente recibe correcciones de seguridad.

## Alcance

Sí entra:

- Lectura o escritura de archivos fuera del Espacio (por ejemplo, rutas con `..` en adjuntos o en la copia en Markdown).
- Archivos `.md`, imágenes o bases SQLite manipuladas que hagan fallar, colgar o comprometer la app.
- Comandos IPC que acepten entradas que deberían rechazar.
- Fugas de claves de API del almacén de credenciales de Windows, o que aparezcan en logs o archivos.
- El puente de IA: que un CLI local pueda leer el Espacio sin pasar por MCP, o que Fossil lea credenciales de otro programa.
- El servidor MCP y la API local (R2+): acceso sin token, escucha fuera de `127.0.0.1`, acciones destructivas sin confirmación.
- La política de seguridad de contenido (CSP) de la ventana y la inyección de HTML o scripts desde páginas.
- El proceso de compilación y publicación: workflows, dependencias, integridad del instalador.

No entra: errores sin impacto en seguridad (usa un issue normal), ataques que requieren control
total previo de la cuenta de Windows, e ingeniería social.

## Cómo está protegido hoy

- Nada escucha en la red. Las superficies locales futuras (MCP, API, recortador) escucharán solo en
  `127.0.0.1` y exigirán token ([`docs/DOD.md`](docs/DOD.md) § Seguridad).
- Las claves de API viven en el Administrador de credenciales de Windows, nunca en archivos ni logs.
- Fossil nunca lee ni reutiliza las credenciales de otros CLIs o apps (ADR-0011).
- Los adjuntos solo se leen dentro de `attachments/` del Espacio; hay tests contra rutas con `..`.
- La ventana usa una CSP restrictiva (`apps/desktop/src-tauri/tauri.conf.json`).
- Rust de producción no hace `unwrap`/`expect` sin justificar; clippy corre con `-D warnings`.
- CI revisa en cada PR que no entren rutas personales ni nombres prohibidos (`scripts/check-denylist.ps1`).
