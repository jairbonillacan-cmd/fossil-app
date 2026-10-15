//! Fossil local agent bridge: runs the official CLIs (agy, claude, codex)
//! already logged in on the user's machine as child processes, headless or
//! over ACP. Fossil never reads or reuses their credentials (ADR-0011).
//!
//! R0 placeholder — see `docs/ARCHITECTURE.md` § IA.

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-bridge";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
