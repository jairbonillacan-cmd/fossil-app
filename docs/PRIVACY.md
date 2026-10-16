# Privacidad

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión · **Versión:** 0.1.1-alpha.2

Fossil es local primero: tu trabajo vive en tu computadora y solo sale cuando tú eliges un servicio
que lo necesita. Esta página dice qué se guarda, dónde, y qué sale. Si el código hace algo distinto
de lo que dice aquí, es un error de seguridad: repórtalo según [`../SECURITY.md`](../SECURITY.md).

## Lo que Fossil no hace

- **No tiene telemetría.** No envía uso, errores, métricas ni identificadores a ningún servidor.
- **No exige cuenta.** La app funciona completa sin registrarte.
- **No tiene servidor de IA propio.** Tus páginas nunca pasan por un servidor de Fossil para llegar a un modelo.
- **No lee credenciales de otras apps.** Ni las sesiones de los CLIs de IA, ni las del navegador (ADR-0011).

La ventana de la app tiene una política de seguridad de contenido que solo permite conexiones a
la propia app (`connect-src 'self' ipc: http://ipc.localhost` en `apps/desktop/src-tauri/tauri.conf.json`).

## Qué se guarda y dónde

| Qué | Dónde | Notas |
|---|---|---|
| Tus páginas, su historial y el índice de búsqueda | `<tu Espacio>\.fossil\fossil.db` | SQLite. La carpeta del Espacio la eliges tú |
| Copia en Markdown de cada página | `<tu Espacio>\*.md` | Se reescribe 2 s después de cada cambio |
| Imágenes pegadas o arrastradas | `<tu Espacio>\attachments\` | Solo se leen dentro de esta carpeta |
| Lista de Espacios recientes | `%APPDATA%\Fossil\config.json` | Rutas de las carpetas que abriste |
| Tamaño y posición de la ventana | `%APPDATA%\<id de la app>\.window-state.json` | |
| Tema, densidad e idioma | Almacenamiento local de WebView2, en `%LOCALAPPDATA%\<id de la app>\` | |
| Claves de API de proveedores de IA | Administrador de credenciales de Windows | Nunca en archivos ni en logs |

Para borrar todo: elimina la carpeta del Espacio, `%APPDATA%\Fossil\config.json`, las dos carpetas `<id de la app>` y las
credenciales de Fossil en el Administrador de credenciales de Windows.

## Qué sale de tu computadora, y cuándo

Hoy (0.1), **nada**. A medida que lleguen las funciones, solo sale lo siguiente, siempre por una
acción tuya o una configuración que tú hiciste:

| Cuándo | Qué sale | A dónde | Desde |
|---|---|---|---|
| Usas IA con una clave de API | El texto que envías y el contexto que elijas (página, selección) | El proveedor que configuraste: Anthropic, OpenAI, Gemini u OpenRouter | R1 |
| Usas un CLI de IA instalado | Lo mismo, a través de ese CLI | El servicio de ese CLI, con tu sesión | R1 |
| Usas un modelo local (Ollama, LM Studio) | Nada sale: corre en tu computadora | — | R1 |
| Activas un Espacio de equipo | Los cambios de tus páginas | El servidor de sincronización de tu Espacio | R3 |
| Compartes un enlace de aprobación | La publicación que compartes | El portal web, para quien tenga el enlace | R4 |
| Conectas tu tienda o tus cuentas de anuncios | Nada de tus páginas; Fossil **lee** ventas, pedidos y métricas | Las APIs de esos servicios, con tu autorización | R5 |
| Programas una publicación | La publicación aprobada | La red social elegida | R6 |

Con el chat de IA (R1), Fossil mostrará qué contexto va a enviar antes de enviarlo, y cada Espacio
podrá tener una política "solo modelos locales" que bloquea el resto.

## Espacios de equipo (R3 en adelante)

- **Gestionado:** el servidor puede leer el contenido. Es lo que permite publicar a una hora, el
  portal de aprobaciones, las alertas y los conectores.
- **Privado (R7):** cifrado de extremo a extremo; el servidor solo guarda datos cifrados y esas
  funciones no están disponibles.

Esta página se actualiza en el mismo PR que cambie cualquiera de estas filas.
