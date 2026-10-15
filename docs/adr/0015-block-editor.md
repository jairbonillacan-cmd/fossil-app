# ADR-0015: Editor de bloques con TipTap 3 + y-prosemirror y IDs de bloque como atributos

- **Estado:** aceptado (validado por el spike #13) · **Fecha:** 2026-10-14 · **Área:** `area:editor`

## Contexto
El editor es la superficie principal de Fossil (spec `docs/specs/r1-editor.md`): debe
escribirse rápido con documentos grandes, mantener bloques referenciables (ADR-0005) y
fusionar ediciones sin conflictos sobre el doc Yjs del objeto (ADR-0003). El spike #13
probó el stack candidato con 5 000 bloques (TipTap 3 + y-prosemirror + IDs de bloque +
outliner por sangría) midiendo carga, tecleo, memoria y el ciclo de vida de los IDs.

## Decisión
1. **Stack:** TipTap 3 (solo extensiones MIT) sobre ProseMirror, sincronizado con
   `y-prosemirror` contra el `Y.XmlFragment` del cuerpo del objeto. Versiones exactas
   validadas: `@tiptap/*` 3.32.0, `y-prosemirror` 1.3.7, `yjs` 13.6.33.
2. **IDs de bloque como atributos** de nodo (`blockId`) replicados como atributo del
   `Y.XmlElement` correspondiente. El binding los conserva en ambos sentidos (medido:
   5 000/5 000 al cargar y tras teclear; cambio de atributo PM→Yjs verificado con sonda;
   round-trip `encodeStateAsUpdate` → `applyUpdate` conserva los 5 001 ids en el mismo
   orden). ID generado con `crypto.randomUUID()` (nativo en el WebView2, sin deps).
3. **Asignación en el lado del editor:** una extensión (`appendTransaction`) reasigna un
   id fresco a todo nodo nuevo sin id **y a todo nodo con id duplicado**: Enter hereda
   el id del bloque original (medido: 1 duplicado por split). No hay carrera entre
   clientes: el nodo nuevo nace en un solo cliente y viaja con su atributo.
4. **La estructura del doc Yjs debe reproducir el content model del schema:** `listItem`
   y `blockquote` contienen `paragraph`s, nunca texto directo. Si un elemento no calza
   con el schema, y-prosemirror lo **borra del doc Yjs** sin error visible (medido:
   758 de 5 000 bloques desaparecieron con estructura inválida).
5. **Undo/redo con `Y.UndoManager`** (el history de TipTap va desactivado,
   `undoRedo: false`); validar en #23 que no rompe ids ni mapping.
6. **Hook de plugins de TipTap 3:** `addProseMirrorPlugins` (era `addProsemirrorPlugins`
   en TipTap 2; con el nombre viejo el plugin se ignora en silencio y no hay sync).

## Consecuencias
Medidas del spike #13 con 5 000 bloques (i7-8665U, Chrome headless — mismo motor que
WebView2; harness en `apps/desktop/spike-editor/`, rama `spike/13-block-editor`):
- **Carga a editor listo:** ~0.1 s construir/aplicar el doc + ~0.35 s importar y
  renderizar + ~0.2 s hasta frames estables (~0.65 s de trabajo del editor).
- **Tecleo:** p50 10–16 ms y p95 15–21 ms por pulsación, en el límite del presupuesto
  de 16 ms. El coste por transacción crece **lineal** con el número de bloques
  (~2.5 µs/bloque: 500 bloques → 2 ms; 4 000 → 10 ms) dentro del binding de
  y-prosemirror. Documentos outliner de más de ~5 000 bloques necesitan mitigación
  (paginación por secciones u optimización del binding; issue aparte si hace falta).
- **Memoria:** ~30 MB de heap JS con el doc cargado (~55 MB durante el tecleo intenso);
  ~14 k nodos DOM (ProseMirror renderiza el doc completo: sin virtualización).
- **Transporte:** el update Yjs completo del doc pesa ~0.9 MB; relevante para el
  batching de 250 ms y los snapshots (ADR-0003).

## Alternativas
- **Loro / Automerge:** ya descartados en ADR-0003 (bindings jóvenes para editores ricos).
- **IDs como nodos propios en vez de atributos:** más difícil de mantener con el binding
  de y-prosemirror y no aporta referencias que el atributo no resuelva.
- **Lexical / Plate:** no probados; TipTap tiene la integración y-prosemirror documentada
  y el spike validó el comportamiento completo (sync, atributos, split, round-trip).
