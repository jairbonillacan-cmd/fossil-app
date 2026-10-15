//! Fossil data layer: ingestion of external data sources, materialized
//! models and dataset handling for analytics and charts.
//!
//! R0 placeholder — see `docs/FEATURES.md` §11–§13.

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-data";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
