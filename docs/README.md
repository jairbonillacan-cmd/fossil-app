# Documentación de Fossil

Empieza por la fila que te describe y lee solo lo que necesitas.

## Si usas Fossil

| Doc | Qué responde |
|---|---|
| [`OVERVIEW.md`](OVERVIEW.md) | Qué es Fossil, para quién, sus conceptos y un día de uso |
| [`STATUS.md`](STATUS.md) | Qué funciona hoy y qué no, con números |
| [`FEATURES.md`](FEATURES.md) | Todas las funciones, por categoría, con su release |
| [`../ROADMAP.md`](../ROADMAP.md) · [`../CHANGELOG.md`](../CHANGELOG.md) | Qué viene · qué cambió en cada versión |
| [`PRIVACY.md`](PRIVACY.md) | Qué guarda Fossil, dónde, y qué sale de tu computadora |
| [`GLOSSARY.md`](GLOSSARY.md) | Qué significa cada nombre de la interfaz |
| [`../SUPPORT.md`](../SUPPORT.md) | Dónde preguntar y cómo reportar un error |

## Si contribuyes

| Doc | Qué responde |
|---|---|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Cómo proponer un cambio, de la idea al merge |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Requisitos, compilar, correr, capturas, depurar |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Estado medido del código, capas, reglas de diseño, almacenamiento, IA |
| [`TESTING.md`](TESTING.md) | Qué pruebas hay, cómo escribir una, fixtures |
| [`PERFORMANCE.md`](PERFORMANCE.md) | Presupuestos de rendimiento, cómo se miden, últimos números |
| [`DOD.md`](DOD.md) | El checklist que cumple todo PR |
| [`DESIGN.md`](DESIGN.md) | Guía visual: tokens, tipografía, Mica, reglas de interfaz |
| [`modules/`](modules/) | Un mapa corto por módulo: archivos clave, contratos, trampas |
| [`adr/`](adr/) | Decisiones de arquitectura, una por archivo, con su porqué |
| [`specs/`](specs/) | Qué construir en cada área y cómo se acepta |

## Si eres un agente de IA

[`../AGENTS.md`](../AGENTS.md) primero; después [`PROTOCOL.md`](PROTOCOL.md) (roles, carriles,
identidad, handoff), el `modules/<área>.md` de tu issue y la sección "Contexto a leer" del issue.

## Si mantienes el proyecto

| Doc | Qué responde |
|---|---|
| [`MILESTONES.md`](MILESTONES.md) | Releases con criterio de "listo", riesgos y diferidos |
| [`RELEASING.md`](RELEASING.md) | Cómo se versiona, se compila y se publica una versión |
| [`../SECURITY.md`](../SECURITY.md) | Cómo se reciben y atienden reportes de seguridad |
| [`retro/`](retro/) | Retrospectiva de cada release |
| [`backlog/`](backlog/) | Backlog por release antes de volverse issues |

## Convenciones de estos documentos

- **Cabecera de estado** en los documentos vivos: `Última revisión · Última actualización · Cambio`.
  Quien cambia el contenido actualiza la cabecera en el mismo PR.
- **Números con fuente.** Todo número dice cuándo se midió y con qué comando o archivo.
- **Español de México** en docs y en la interfaz; inglés en código, identificadores y commits.
- **Sin nombres de otros productos** ni comparaciones. Las integraciones sí se nombran.
- **Cortos.** Un mapa de módulo cabe en 80 líneas; si un doc crece, se divide.
