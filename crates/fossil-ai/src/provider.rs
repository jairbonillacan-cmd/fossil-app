//! The `Provider` trait — what every AI backend implements for the router
//! (spec r1-ai-router-bridge §Contrato). Rust-side only, not an IPC surface:
//! errors use `thiserror` without `specta`.

use crate::contract::{Caps, ChatEvent, ChatRequest, ChatSummary, Health, ProviderId};

/// Failures reported by a provider; the router maps these to `AiError` or
/// falls back to the next provider in the chain. Covers: unusable before any
/// request (`Unavailable`: not installed, no session, no key), `Timeout`,
/// `Cancelled` by the user, `Failed` mid-request and `Unsupported` asks.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    #[error("provider unavailable: {0}")]
    Unavailable(String),
    #[error("request timed out after {0} ms")]
    Timeout(u32),
    #[error("request cancelled")]
    Cancelled,
    #[error("provider failed: {0}")]
    Failed(String),
    #[error("capability not supported: {0}")]
    Unsupported(String),
}

/// A chat-capable AI backend. Bridge providers (#33) spawn the official CLI
/// headless and translate its NDJSON into [`ChatEvent`]s (ADR-0013); API and
/// Ollama providers (#32) call HTTP. Cheap to construct and stateless between
/// calls: the router owns them and probes `health` lazily, never at app boot.
#[async_trait::async_trait]
pub trait Provider: Send + Sync {
    /// Stable identity of this provider.
    fn id(&self) -> ProviderId;

    /// Static capability flags.
    fn capabilities(&self) -> Caps;

    /// Probes install/session state on demand; never reads credentials
    /// (ADR-0011): "session" is whatever the official CLI itself reports.
    async fn health(&self) -> Health;

    /// Runs one chat request, streaming [`ChatEvent`]s through `events` until
    /// `Done`/`Error` and returning the same summary as the terminal event.
    /// Dropping the receiver cancels the request.
    async fn chat(
        &self,
        request: ChatRequest,
        events: tokio::sync::mpsc::Sender<ChatEvent>,
    ) -> Result<ChatSummary, ProviderError>;
}
