//! Materializes the deterministic corpus (#78) to disk so reproducibility can
//! be verified by hand: run it twice with the same seed and compare SHA-256
//! hashes of the files (PowerShell: `Get-FileHash <archivos> -Algorithm SHA256`).
//!
//! ```text
//! cargo run -p fossil-core --example corpus -- --out corpus --seed 20261015 --pages 10000
//! ```
#![allow(clippy::unwrap_used)] // Developer tool: bad arguments must fail loudly, not silently.

#[path = "../benches/corpus/mod.rs"]
mod corpus;

use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

fn die(message: &str) -> ! {
    eprintln!("corpus: {message}");
    std::process::exit(2);
}

fn main() {
    let mut out = PathBuf::from("corpus");
    let mut seed = corpus::DEFAULT_SEED;
    let mut page_count = corpus::PAGES_LARGE;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || {
            args.next()
                .unwrap_or_else(|| die(&format!("{arg} requires a value")))
        };
        match arg.as_str() {
            "--out" => out = PathBuf::from(value()),
            "--seed" => {
                seed = value()
                    .parse()
                    .unwrap_or_else(|_| die("--seed expects an integer"))
            }
            "--pages" => {
                page_count = value()
                    .parse()
                    .unwrap_or_else(|_| die("--pages expects an integer"))
            }
            other => die(&format!(
                "unknown argument {other} (usage: --out <dir> --seed <u64> --pages <n>)"
            )),
        }
    }

    fs::create_dir_all(&out).unwrap();
    let mut pages_txt = String::new();
    for p in corpus::pages(page_count) {
        let _ = writeln!(pages_txt, "{}\t{}\t{}", p.id, p.title, p.body);
    }
    let pages_file = out.join(format!("pages-{page_count}.txt"));
    fs::write(&pages_file, pages_txt).unwrap();

    let mut doc_md = String::from("# Plan de contenido de Acme\n\n");
    for b in corpus::doc_blocks(seed, corpus::DOC_BLOCK_COUNT) {
        if b.tag == "heading" {
            doc_md.push_str("## ");
        }
        let _ = writeln!(doc_md, "{}\n", b.text);
    }
    let doc_file = out.join(format!("doc-{}.md", corpus::DOC_BLOCK_COUNT));
    fs::write(&doc_file, doc_md).unwrap();

    println!("seed:   {seed}");
    println!("pages:  {}", pages_file.display());
    println!("doc:    {}", doc_file.display());
    println!("verify: run again with the same seed and compare Get-FileHash SHA256 of both files");
}
