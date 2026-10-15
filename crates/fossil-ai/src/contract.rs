//! Wire contract of the AI subsystem (spec r1-ai-router-bridge §Contrato, #16).
//!
//! specta-typescript cannot export i64/u64: tokens are u32, money is f64 and
//! durations are u32 ms. Identifiers are Ulid strings, like the rest of Fossil.

use serde::{Deserialize, Serialize};

/// A routable AI provider: one flat union for the whole wire format.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
pub enum ProviderId {
    // Bridge CLIs (fossil-bridge, ADR-0011/0013): the user's subscriptions.
    Agy,
    Claude,
    Codex,
    // API-key providers.
    Anthropic,
    OpenAi,
    Gemini,
    // Local models.
    Ollama,
}

impl ProviderId {
    /// Every provider, in the canonical order used by the default routes.
    pub fn all() -> &'static [ProviderId] {
        use ProviderId::*;
        &[Agy, Claude, Codex, Anthropic, OpenAi, Gemini, Ollama]
    }
}

/// What a provider can do; consumed by the router when picking a fallback.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Caps {
    pub chat: bool,
    pub tools: bool,
    pub embeddings: bool,
    pub streaming: bool,
    pub local: bool,
}

/// Session/installation state of a provider. Probed lazily (spike #14: CLI
/// startup costs 0.3–2.5 s), never automatically at app boot.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum HealthStatus {
    #[default]
    Unknown, // not probed yet
    NotInstalled, // binary not found on PATH (or known install dir for `agy`)
    NoSession,    // installed, but the CLI reports no active session
    Ready,        // probed and usable
    Error,        // probe failed unexpectedly (see `Health::detail`)
}

/// Result of a provider probe.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Health {
    pub status: HealthStatus,
    /// CLI/server version, when known without spending a request.
    pub version: Option<String>,
    /// Human-readable extra (never credentials), shown in Settings → IA.
    pub detail: Option<String>,
}

/// A provider as seen from the UI (`ai_providers`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ProviderInfo {
    pub id: ProviderId,
    pub caps: Caps,
    pub health: Health,
}

/// Identifier of one chat request; assigned by `ai_chat` and echoed by every
/// `ai:event` (Ulid string on the wire).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(transparent)]
pub struct RequestId(pub String);

impl RequestId {
    /// Generates a new identifier.
    pub fn new() -> Self {
        Self(ulid::Ulid::generate().to_string())
    }
}

impl Default for RequestId {
    fn default() -> Self {
        Self::new()
    }
}

/// Context chip attached to a chat request; object ids are vault Ulid strings,
/// resolved to text by the backend in #33.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub enum ChatContext {
    Page { object_id: String },   // the page open in the editor
    Selection { text: String },   // the current text selection
    Object { object_id: String }, // an `@object` reference picked by the user
}

/// Per-request knobs; `None` means "router decides".
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ChatOptions {
    /// Force one provider, bypassing the route chain.
    pub provider: Option<ProviderId>,
    /// Model hint (alias or full name, spike #14: `--model`/`-m`).
    pub model: Option<String>,
    /// Hard cap for the whole request in milliseconds (default: config, #32).
    pub timeout_ms: Option<u32>,
}

/// One turn of conversation, as sent by the UI.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct ChatRequest {
    pub prompt: String,
    #[serde(default)]
    pub context: Vec<ChatContext>,
    #[serde(default)]
    pub options: ChatOptions,
}

/// Token/cost accounting of a request (spike #14: bridge CLIs report usage in
/// their final event; subscriptions have no per-call price).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// Estimated cost in USD, when the provider reports it.
    pub cost_usd: Option<f64>,
}

/// Final outcome of a completed chat request.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct ChatSummary {
    pub request_id: RequestId,
    pub provider: ProviderId,
    /// Model that actually answered (ADR-0011: the chat shows it).
    pub model: String,
    pub usage: Usage,
    /// Wall time from request start to completion, milliseconds.
    pub duration_ms: u32,
}

/// Streaming events of a chat request (spike #14: providers identify
/// themselves, stream deltas and end with usage).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub enum ChatEvent {
    Started { provider: ProviderId, model: String }, // who is answering
    Delta { text: String },                          // incremental answer text
    ToolCall { name: String, arguments: String },    // provider ran a tool (R2+)
    Usage(Usage),                                    // may arrive more than once
    Done { summary: ChatSummary },                   // terminal success
    Error { message: String },                       // terminal failure; nothing follows
}

/// Task classes the router knows about (ADR-0011 usage table).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
pub enum TaskKind {
    Chat,      // panel chat and agent turns
    Inline,    // inline actions on a selection (fast, cheap)
    Embedding, // embeddings for indexing
}

/// Fallback chain for one task: try `prefer` in order, skipping providers
/// that are not installed/ready (spec §Router).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct RouteRule {
    pub task: TaskKind,
    pub prefer: Vec<ProviderId>,
}

/// Default route table (spec §Router, ADR-0011). Order matters: the router
/// walks `prefer` left to right.
pub fn default_routes() -> Vec<RouteRule> {
    use ProviderId::*;
    let rule = |task, prefer| RouteRule { task, prefer };
    vec![
        // chat: bridge (agy → claude → codex) → API → Ollama
        rule(
            TaskKind::Chat,
            vec![Agy, Claude, Codex, Anthropic, OpenAi, Gemini, Ollama],
        ),
        // inline: fast API first, bridge last (latency, spike #14)
        rule(
            TaskKind::Inline,
            vec![Anthropic, OpenAi, Gemini, Ollama, Agy, Claude, Codex],
        ),
        // embedding: Anthropic exposes no embeddings API
        rule(TaskKind::Embedding, vec![OpenAi, Gemini, Ollama]),
    ]
}

/// Errors of the `ai_*` IPC commands.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, specta::Type)]
pub enum AiError {
    #[error("not implemented yet (contract #16)")]
    NotImplemented,
    #[error("invalid route: {0}")]
    InvalidRoute(String),
    #[error("no available provider: {0}")]
    NoProvider(String),
    #[error("provider failure: {0}")]
    ProviderFailure(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_routes_match_the_spec_table() {
        use ProviderId::*;
        let routes = default_routes();
        assert_eq!(routes.len(), 3);
        assert_eq!(
            routes[0].prefer,
            vec![Agy, Claude, Codex, Anthropic, OpenAi, Gemini, Ollama]
        );
        assert_eq!(routes[1].prefer.first(), Some(&Anthropic));
        assert_eq!(routes[1].prefer.last(), Some(&Codex));
        assert_eq!(routes[2].prefer, vec![OpenAi, Gemini, Ollama]);
    }

    #[test]
    fn wire_types_round_trip_through_json() {
        let delta = ChatEvent::Delta {
            text: "hola".into(),
        };
        let json = serde_json::to_value(&delta).unwrap();
        assert_eq!(json, serde_json::json!({ "Delta": { "text": "hola" } }));
        assert_eq!(serde_json::from_value::<ChatEvent>(json).unwrap(), delta);

        let id = RequestId::new();
        assert!(id.0.parse::<ulid::Ulid>().is_ok());
        assert_eq!(serde_json::to_string(&id).unwrap(), format!("\"{}\"", id.0));
    }
}
