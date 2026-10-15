//! Fossil shared contracts: wire formats and versioned protocols shared by
//! the desktop app, Fossil Cloud and the web portal.
//!
//! R0 placeholder — sync contracts land with cloud work (R3+).

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-proto";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
