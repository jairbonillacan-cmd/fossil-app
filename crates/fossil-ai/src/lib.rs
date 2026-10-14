//! Fossil AI router: routes each task to the best available provider (bridge
//! CLIs, API keys, Ollama) with streaming and cost tracking.
//!
//! Contract crate (#16): `contract` holds the wire types shared with the
//! typed IPC; `provider` holds the Rust-side trait each backend implements.

pub mod anthropic;
pub mod contract;
pub mod gemini;
pub mod http;
pub mod keyring;
pub mod ollama;
pub mod openai;
pub mod provider;
pub mod router;

pub use anthropic::AnthropicProvider;
pub use contract::*;
pub use gemini::GeminiProvider;
pub use keyring::{KeyStore, MemoryKeyring, OsKeyring, SecretKey};
pub use ollama::OllamaProvider;
pub use openai::OpenAiProvider;
pub use provider::{Provider, ProviderError};
pub use router::{AiRouter, UsageRecord, global_router};

/// Canonical crate name, sanity-checked against the package name in tests.
pub const CRATE_NAME: &str = "fossil-ai";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
