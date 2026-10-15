//! Fossil MCP integration: Fossil as an MCP client and as a local server
//! (rmcp) so external agents can act on the vault through scoped tools.
//!
//! R0 placeholder — server work starts in R1+ (`docs/FEATURES.md` §15).

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-mcp";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
