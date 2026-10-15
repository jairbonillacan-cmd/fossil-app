//! Fossil OS integration (Windows only): system toasts, global shortcuts,
//! OCR via Windows.Media.Ocr and Windows credential storage access.
//!
//! R0 placeholder — see `docs/ARCHITECTURE.md` § Stack.

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-os";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
