//! Criterion benchmark for 10,000 synthetic objects (#20, specs `r1-search` & `r1-objects-storage`):
//! verifies vault open < 1 s and FTS5 search with operators < 50 ms (p95).
#![allow(clippy::unwrap_used)] // Benchmark harness: setup/measurement failures must panic immediately.

#[path = "corpus/mod.rs"]
mod corpus;

use criterion::{Criterion, criterion_group, criterion_main};
use fossil_core::objects::{ObjectFilter, TypeKey};
use fossil_core::search::{SearchQuery, search_query};
use fossil_core::storage::open_vault;
use rusqlite::{Connection, params};
use std::time::{Duration, Instant};

const OBJECT_COUNT: usize = 10_000;

fn seed_10k_vault(path: &str) -> Connection {
    let mut conn = open_vault(path).unwrap();
    let tx = conn.transaction().unwrap();
    let mut o_q = tx
        .prepare("INSERT INTO objects VALUES (?1,?2,?3,NULL,NULL,?4,?4,0)")
        .unwrap();
    let mut t_q = tx.prepare("INSERT INTO tags VALUES (?1,?2)").unwrap();
    let mut f_q = tx
        .prepare("INSERT INTO fts_objects VALUES (?1,?2,?3)")
        .unwrap();
    for p in corpus::pages(OBJECT_COUNT) {
        o_q.execute(params![p.id, p.types, p.title, p.created_at_ms])
            .unwrap();
        t_q.execute(params![p.id, p.tag]).unwrap();
        f_q.execute(params![p.id, p.title, p.body]).unwrap();
    }
    drop((o_q, t_q, f_q));
    tx.commit().unwrap();
    conn
}

fn time_search(conn: &Connection, q: &SearchQuery) -> Duration {
    let t0 = Instant::now();
    assert!(!search_query(conn, q).unwrap().is_empty());
    t0.elapsed()
}

fn bench_10k(c: &mut Criterion) {
    let dir = tempfile::tempdir().unwrap();
    let db_buf = dir.path().join("vault.db");
    let db_path = db_buf.to_str().unwrap();
    let conn = seed_10k_vault(db_path);
    let (t_open, v) = (Instant::now(), open_vault(db_path).unwrap());
    let n = fossil_core::object_store::list(&v, ObjectFilter::default())
        .unwrap()
        .len();
    assert!(n == OBJECT_COUNT && t_open.elapsed() < Duration::from_secs(1));
    drop(v);

    let query = SearchQuery {
        text: "\"campana trimestral\" -borrador tag:estrategia/q4 type:page".into(),
        type_key: Some(TypeKey::Page),
        limit: Some(50),
        ..Default::default()
    };
    let mut samples: Vec<_> = (0..40).map(|_| time_search(&conn, &query)).collect();
    samples.sort_unstable();
    assert!(samples[(samples.len() * 95) / 100] < Duration::from_millis(50));

    let mut group = c.benchmark_group("r1_search_10k");
    group.sample_size(20);
    group.bench_function("vault_open_10k", |b| {
        b.iter(|| {
            let v = open_vault(db_path).unwrap();
            let n: i64 = v
                .query_row("SELECT COUNT(*) FROM objects", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n as usize, OBJECT_COUNT);
        });
    });
    group.bench_function("search_fts_10k", |b| b.iter(|| time_search(&conn, &query)));
    group.finish();
}

criterion_group!(benches, bench_10k);
criterion_main!(benches);
