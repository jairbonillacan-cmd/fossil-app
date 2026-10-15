# ADR-0017: Nombres en la interfaz y sitio público

- **Estado:** aceptado (2026-10-15, decisión del PO)
- **Relacionado:** `docs/GLOSSARY.md`, `docs/DESIGN.md`, `AGENTS.md`

## Contexto
Varios nombres de funciones estaban en inglés o eran jerga de otras herramientas (Bóveda, Journal y términos de marketing en inglés). La interfaz parecía una copia y no decía en español qué hace cada cosa. Además, el producto necesita una página pública con su changelog y su roadmap.

## Decisión
1. **La marca sigue siendo Fossil.** El PO evaluó cambiarla a Auralis y decidió no hacerlo por ahora.
2. **El sitio público se publica en `auralisgo.com` mientras tanto.** Es un dominio provisional del PO: el sitio dice "Fossil" aunque viva en ese dominio.
3. **Los nombres de las funciones en la interfaz son los de la columna "En la interfaz" de `docs/GLOSSARY.md`.** El código puede seguir usando el término interno (`vault`, `journal`, `object`). Por ejemplo, el usuario ve **Espacio** y el código dice `vault`.
4. **Fuera del repo interno no nos comparamos con otros productos.** En el sitio, el changelog, el roadmap y los textos de la app no se usa otro producto como referencia ("como X", "alternativa a X") ni se toman prestados sus nombres de funciones. Sí se nombran las integraciones, los proveedores de IA y las plataformas que Fossil conecta (por ejemplo una tienda, una red social o un modelo de IA). Los docs internos sí pueden compararse con ellos.

## Consecuencias
- En la app solo cambian los textos de i18n ("bóveda" pasa a "espacio") y sus tests.
- Los agentes usan los nombres de la columna "En la interfaz" en todo lo que ve el usuario.
- Si la marca cambia más adelante, será otro ADR.
