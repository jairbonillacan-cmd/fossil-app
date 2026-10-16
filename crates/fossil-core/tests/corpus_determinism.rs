//! The corpus is the reproducibility contract of every benchmark (#78):
//! the same seed yields identical bytes, a different seed does not.

#[path = "../benches/corpus/mod.rs"]
mod corpus;

#[test]
fn same_seed_yields_identical_bytes() {
    let a = corpus::canonical_bytes(corpus::DEFAULT_SEED, corpus::PAGES_LARGE);
    let b = corpus::canonical_bytes(corpus::DEFAULT_SEED, corpus::PAGES_LARGE);
    assert!(!a.is_empty());
    assert_eq!(a, b, "same seed must reproduce the corpus byte for byte");
}

#[test]
fn different_seed_changes_the_document() {
    let a = corpus::canonical_bytes(1, corpus::PAGES_SMALL);
    let b = corpus::canonical_bytes(2, corpus::PAGES_SMALL);
    assert_ne!(a, b, "the seed must actually drive the content");
}

#[test]
fn variants_have_the_requested_sizes() {
    assert_eq!(corpus::pages(corpus::PAGES_SMALL).len(), 1_000);
    assert_eq!(corpus::pages(corpus::PAGES_LARGE).len(), 10_000);
    let doc = corpus::doc_blocks(corpus::DEFAULT_SEED, corpus::DOC_BLOCK_COUNT);
    assert_eq!(doc.len(), 5_000);
    assert!(doc.iter().any(|b| b.tag == "heading"));
    assert!(doc.iter().any(|b| b.text.contains("[[")));
}
