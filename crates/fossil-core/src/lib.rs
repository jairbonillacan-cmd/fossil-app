//! Fossil domain core: object graph types, storage migrations and (in later
//! R1 issues) CRDT documents, indexing and queries (`docs/ARCHITECTURE.md`).

pub mod attachments;
pub mod capture;
pub mod doc_store;
pub mod fs_guard;
pub mod ids;
pub mod indexer;
pub mod journal;
pub mod markdown;
pub mod mirror;
pub mod object_store;
pub mod objects;
pub mod search;
pub mod snapshots;
pub mod storage;
pub mod vault;

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-core";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
