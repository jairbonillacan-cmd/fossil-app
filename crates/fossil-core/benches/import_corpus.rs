//! Criterion benchmarks for the corpus scenarios of #78: importing the
//! 1 000-page corpus through the real object path (the same calls the app's
//! `object_create` and its debounced indexer make) and loading/indexing the
//! 5 000-block document. Scrolling that document in the UI needs the app
//! open and stays pending in #78; these are the data-level proxies.
#![allow(clippy::unwrap_used)] // Benchmark harness: setup/measurement failures must panic immediately.

#[path = "corpus/mod.rs"]
mod corpus;

use criterion::{Criterion, criterion_group, criterion_main};
use fossil_core::ids::ObjectId;
use fossil_core::objects::{NewObject, TypeKey};
use fossil_core::{doc_store, indexer, object_store, storage::open_vault};
use rusqlite::Connection;
use std::cell::Cell;
use std::time::Duration;
use yrs::{Any, Doc, ReadTxn, Transact, Xml, XmlElementPrelim, XmlFragment, XmlTextPrelim};

fn open_temp_vault() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("vault.db");
    let conn = open_vault(db.to_str().unwrap()).unwrap();
    (dir, conn)
}

/// Encodes a page as a small Yjs document (3-6 paragraph blocks), one lib0 v1
/// update, the shape one editor session produces.
fn page_update(id: &ObjectId, body: &str, prng: &mut corpus::Prng) -> Vec<u8> {
    let doc = Doc::new();
    let fragment = doc.get_or_insert_xml_fragment("body");
    let mut txn = doc.transact_mut();
    for n in 0..3 + prng.below(4) {
        let el = fragment.push_back(&mut txn, XmlElementPrelim::empty("paragraph"));
        el.insert_attribute(
            &mut txn,
            "blockId",
            Any::from(format!("{id}-b{n}").as_str()),
        );
        el.push_back(
            &mut txn,
            XmlTextPrelim::new(format!("{body} ({n}).").as_str()),
        );
    }
    txn.encode_update_v1()
}

/// Imports one page: metadata, document update and index, exactly what
/// `object_create` plus its debounced indexer do in the app.
fn import_page(conn: &mut Connection, page: &corpus::Page, prng: &mut corpus::Prng) {
    let meta = object_store::create(
        conn,
        NewObject {
            types: vec![TypeKey::Page],
            title: page.title.clone(),
            icon: None,
            parent: None,
        },
    )
    .unwrap();
    doc_store::apply_update(conn, &meta.id, &page_update(&meta.id, &page.body, prng)).unwrap();
    indexer::index_object(conn, &meta.id).unwrap();
}

/// Applies the long document as ~50 updates (the log shape of an editing
/// session) and indexes it once.
fn seed_long_doc(conn: &mut Connection, title: &str) -> ObjectId {
    let meta = object_store::create(
        conn,
        NewObject {
            types: vec![TypeKey::Page],
            title: title.to_owned(),
            icon: None,
            parent: None,
        },
    )
    .unwrap();
    let doc = Doc::new();
    let fragment = doc.get_or_insert_xml_fragment("body");
    let mut updates: Vec<Vec<u8>> = Vec::new();
    for chunk in corpus::doc_blocks(corpus::DEFAULT_SEED, corpus::DOC_BLOCK_COUNT).chunks(100) {
        let before = {
            let txn = doc.transact();
            txn.state_vector()
        };
        {
            let mut txn = doc.transact_mut();
            for block in chunk {
                let el = fragment.push_back(&mut txn, XmlElementPrelim::empty(block.tag));
                el.insert_attribute(&mut txn, "blockId", Any::from(block.block_id.as_str()));
                el.push_back(&mut txn, XmlTextPrelim::new(block.text.as_str()));
            }
        }
        let update = {
            let txn = doc.transact();
            txn.encode_state_as_update_v1(&before)
        };
        updates.push(update);
    }
    for update in &updates {
        doc_store::apply_update(conn, &meta.id, update).unwrap();
    }
    indexer::index_object(conn, &meta.id).unwrap();
    meta.id
}

fn bench_import(c: &mut Criterion) {
    let mut group = c.benchmark_group("r1_import_corpus");
    // Two slow scenarios: keep sampling short so `--quick` stays usable.
    group.sample_size(10);
    group.warm_up_time(Duration::from_secs(1));

    let (_dir, conn) = open_temp_vault();
    let mut conn = conn;
    let mut prng = corpus::Prng::new(corpus::DEFAULT_SEED);
    let pages = corpus::pages(corpus::PAGES_SMALL);
    let next = Cell::new(0usize);
    group.bench_function("import_page", |b| {
        b.iter(|| {
            let i = next.get();
            next.set(i + 1);
            import_page(&mut conn, &pages[i % pages.len()], &mut prng);
        })
    });

    let pages = corpus::pages(corpus::PAGES_SMALL);
    group.bench_function("import_corpus_1k_fresh_vault", |b| {
        b.iter(|| {
            let (_dir, conn) = open_temp_vault();
            let mut conn = conn;
            let mut prng = corpus::Prng::new(corpus::DEFAULT_SEED);
            for page in &pages {
                import_page(&mut conn, page, &mut prng);
            }
        })
    });
    group.finish();
}

fn bench_doc_5k(c: &mut Criterion) {
    let mut group = c.benchmark_group("r1_doc_5k");
    group.sample_size(10);
    group.warm_up_time(Duration::from_secs(1));

    let (_dir, conn) = open_temp_vault();
    let mut conn = conn;
    let id = seed_long_doc(&mut conn, "Plan de contenido de Acme");
    group.bench_function("load_doc_5k", |b| {
        b.iter(|| {
            let state = doc_store::load(&conn, &id).unwrap();
            assert!(!state.is_empty());
        })
    });
    group.bench_function("index_doc_5k", |b| {
        b.iter(|| indexer::index_object(&mut conn, &id).unwrap())
    });
    group.finish();
}

criterion_group!(benches, bench_import, bench_doc_5k);
criterion_main!(benches);
