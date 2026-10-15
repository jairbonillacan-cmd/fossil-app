# AGENTS.md — crates/fossil-os

Integración de Fossil con Windows (único SO soportado): toasts del sistema, atajos globales (Win+Shift+F), OCR (`Windows.Media.Ocr`) y acceso al Administrador de credenciales.

- Placeholder en R0.
- El acceso a credenciales sigue ADR-0011: solo las propias de Fossil, nunca las de otros CLIs.
- APIs WinRT solo vía crates oficiales (`windows`); sin `unsafe`.
- Hereda `[workspace.package]` y `[workspace.lints]`.
