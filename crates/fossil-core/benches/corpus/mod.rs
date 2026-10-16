//! Deterministic benchmark corpus (#78): the same seed always produces the
//! same bytes, so measurements are comparable across runs and machines.
//! Shared by every bench target, the `corpus` example (which materializes it
//! to disk for SHA-256 checks) and the determinism test; include it with
//! `#[path = "corpus/mod.rs"] mod corpus;`.
//!
//! All content is generic (Acme, "Mi equipo") per AGENTS.md §3.7.

// Shared corpus: every consumer (search_10k, import_corpus, the `corpus`
// example, the determinism test) uses a subset of the contract.
#![allow(dead_code)]

use std::fmt::Write as _;

/// Fixed default seed: corpus bytes are a function of (seed, page count).
pub const DEFAULT_SEED: u64 = 20_261_015;
pub const PAGES_SMALL: usize = 1_000;
pub const PAGES_LARGE: usize = 10_000;
pub const DOC_BLOCK_COUNT: usize = 5_000;

/// SplitMix64: tiny and fully specified, so the same seed yields the same
/// sequence on every platform — the property the corpus depends on.
pub struct Prng(u64);

impl Prng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}

/// One synthetic page: the exact shapes the search bench has always seeded
/// (extracted verbatim from `search_10k` so all scenarios share one corpus).
pub struct Page {
    pub id: String,
    pub types: &'static str,
    pub title: String,
    pub body: String,
    pub tag: &'static str,
    pub created_at_ms: i64,
}

pub fn page(i: usize) -> Page {
    let id = format!("01J8Z000000000000000{i:06}");
    let types = ["[\"Journal\"]", "[\"Page\"]"][usize::from(i % 5 != 0)];
    let kind = ["Campaña trimestral", "Documento operativo"][usize::from(i % 11 != 0)];
    let topic = match (i % 7 == 0, i % 29 == 0) {
        (_, true) => "borrador campaña trimestral",
        (true, _) => "campaña trimestral",
        _ => "métricas",
    };
    Page {
        id,
        types,
        title: format!("{kind} {i}"),
        body: format!("Resumen de {topic} {i}"),
        tag: ["estrategia/q4", "operaciones"][usize::from(i % 3 != 0)],
        created_at_ms: 1_728_000_000_000 + (i as i64) * 1000,
    }
}

pub fn pages(count: usize) -> Vec<Page> {
    (0..count).map(page).collect()
}

/// One block of the long document, in the TipTap shapes the indexer reads
/// (`paragraph`/`heading` elements carrying a `blockId` attribute).
pub struct DocBlock {
    pub tag: &'static str,
    pub block_id: String,
    pub text: String,
}

/// The long-form document: `count` blocks of generic campaign prose with
/// headings, wikilinks and #tags, all PRNG-driven (same seed, same bytes).
pub fn doc_blocks(seed: u64, count: usize) -> Vec<DocBlock> {
    let mut prng = Prng::new(seed);
    let subjects = [
        "El equipo de Acme",
        "Mi equipo",
        "La campaña trimestral",
        "El plan editorial",
    ];
    let verbs = ["cerró", "revisó", "publicó", "aprobó"];
    let objects = [
        "las métricas de la tienda",
        "el calendario de contenido",
        "el resumen de anuncios",
        "la bitácora de la semana",
    ];
    (0..count)
        .map(|i| {
            let block_id = format!("blk-{seed:016x}-{i:05}");
            if i % 13 == 0 {
                return DocBlock {
                    tag: "heading",
                    block_id,
                    text: format!("Sección {} del plan de Acme", i / 13 + 1),
                };
            }
            let mut text = format!(
                "{} {} {} ({}).",
                subjects[prng.below(subjects.len())],
                verbs[prng.below(verbs.len())],
                objects[prng.below(objects.len())],
                i + 1,
            );
            match prng.below(8) {
                0 => text.push_str(" Ver [[Campaña trimestral]]."),
                1 => text.push_str(" Etiqueta: #estrategia/q4."),
                2 => text.push_str(" Etiqueta: #operaciones."),
                _ => {}
            }
            DocBlock {
                tag: "paragraph",
                block_id,
                text,
            }
        })
        .collect()
}

/// Canonical byte form of a corpus variant: what the determinism test
/// compares and what the `corpus` example writes to disk for SHA-256 checks.
pub fn canonical_bytes(seed: u64, page_count: usize) -> Vec<u8> {
    let mut out = String::new();
    for p in pages(page_count) {
        let _ = writeln!(
            out,
            "page\t{}\t{}\t{}\t{}\t{}\t{}",
            p.id, p.types, p.title, p.body, p.tag, p.created_at_ms
        );
    }
    for b in doc_blocks(seed, DOC_BLOCK_COUNT) {
        let _ = writeln!(out, "block\t{}\t{}\t{}", b.tag, b.block_id, b.text);
    }
    out.into_bytes()
}
