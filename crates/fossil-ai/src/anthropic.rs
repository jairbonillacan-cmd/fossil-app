//! Anthropic Messages API provider (`POST /v1/messages` with SSE streaming, #32).

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::mpsc::Sender;

use crate::contract::{Caps, ChatEvent, ChatRequest, ChatSummary, Health, ProviderId, Usage};
use crate::http::{build_prompt, chat_caps, json_str, json_u32, post_sse};
use crate::keyring::{KeyStore, OsKeyring};
use crate::provider::{Provider, ProviderError};

const DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";
type Res<T> = Result<T, ProviderError>;

pub struct AnthropicProvider {
    client: reqwest::Client,
    keys: Arc<dyn KeyStore>,
    base_url: String,
}

impl AnthropicProvider {
    pub fn os() -> Self {
        Self::new(Arc::new(OsKeyring))
    }

    pub fn new(keys: Arc<dyn KeyStore>) -> Self {
        let (client, base_url) = (reqwest::Client::new(), "https://api.anthropic.com".into());
        Self {
            client,
            keys,
            base_url,
        }
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into().trim_end_matches('/').to_owned();
        self
    }
}

fn parse_sse(v: &Value, model: &mut String, u: &mut Usage) -> Res<Option<String>> {
    match json_str(v, "/type").unwrap_or_default() {
        "message_start" => {
            if let Some(m) = json_str(v, "/message/model") {
                *model = m.to_owned();
            }
            u.input_tokens = json_u32(v, "/message/usage/input_tokens").unwrap_or(u.input_tokens);
            Ok(None)
        }
        "content_block_delta" => Ok(json_str(v, "/delta/text").map(str::to_owned)),
        "message_delta" => {
            u.output_tokens = json_u32(v, "/usage/output_tokens").unwrap_or(u.output_tokens);
            let cost = (f64::from(u.input_tokens) * 3.0 + f64::from(u.output_tokens) * 15.0) / 1e6;
            u.cost_usd = Some(cost);
            Ok(None)
        }
        "error" => Err(ProviderError::Failed(
            json_str(v, "/error/message").unwrap_or("error").into(),
        )),
        _ => Ok(None),
    }
}

#[async_trait::async_trait]
impl Provider for AnthropicProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Anthropic
    }

    fn capabilities(&self) -> Caps {
        chat_caps()
    }

    async fn health(&self) -> Health {
        self.keys.health(ProviderId::Anthropic, "Anthropic")
    }

    async fn chat(&self, req: ChatRequest, tx: Sender<ChatEvent>) -> Res<ChatSummary> {
        let key = self.keys.require_key(ProviderId::Anthropic)?;
        let m = req.options.model.as_deref().unwrap_or(DEFAULT_MODEL);
        let model = m.to_owned();
        let msg = json!({ "role": "user", "content": build_prompt(&req) });
        let body = json!({ "model": model, "max_tokens": 4096, "stream": true, "messages": [msg] });
        let http_req = self
            .client
            .post(format!("{}/v1/messages", self.base_url))
            .header("x-api-key", key.expose())
            .header("anthropic-version", "2023-06-01")
            .json(&body);
        post_sse(http_req, &req, ProviderId::Anthropic, model, &tx, parse_sse).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::HealthStatus;
    use crate::http::{collect_chat, spawn_mock_http};
    use crate::keyring::{MemoryKeyring, SecretKey};

    #[tokio::test]
    async fn anthropic_sse_keyring_and_redaction() {
        let fake = "FAKE_TEST_KEY_DO_NOT_USE";
        assert!(!format!("{:?}", SecretKey::new(fake).unwrap()).contains(fake));
        let keys = Arc::new(MemoryKeyring::default());
        let p = |u: String| AnthropicProvider::new(keys.clone()).with_base_url(u);
        let dead = p("http://127.0.0.1:9".into());
        assert_eq!(dead.health().await.status, HealthStatus::NoSession);
        let err_dead = collect_chat(&dead).await.unwrap_err();
        assert!(matches!(err_dead, ProviderError::Unavailable(_)));
        keys.set_key(ProviderId::Anthropic, fake).unwrap();
        let p_401 = p(spawn_mock_http(401, "{}").await);
        let err = collect_chat(&p_401).await.unwrap_err();
        assert!(!err.to_string().contains(fake));
        let sse = "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-sonnet-4-20250514\",\"usage\":{\"input_tokens\":120}}}\n\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hola Fossil\"}}\n\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":10}}\n\n";
        let p_ok = p(spawn_mock_http(200, sse).await);
        assert_eq!(p_ok.health().await.status, HealthStatus::Ready);
        let (s, text) = collect_chat(&p_ok).await.unwrap();
        assert_eq!((s.usage.input_tokens, s.usage.output_tokens), (120, 10));
        assert_eq!(text, "Hola Fossil");
    }
}
