//! OpenAI Chat Completions API provider (`POST /v1/chat/completions` SSE, #32).

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::mpsc::Sender;

use crate::contract::{Caps, ChatEvent, ChatRequest, ChatSummary, Health, ProviderId, Usage};
use crate::http::{build_prompt, chat_caps, json_str, json_u32, post_sse};
use crate::keyring::{KeyStore, OsKeyring};
use crate::provider::{Provider, ProviderError};

const DEFAULT_MODEL: &str = "gpt-4o";
type Res<T> = Result<T, ProviderError>;

pub struct OpenAiProvider {
    client: reqwest::Client,
    keys: Arc<dyn KeyStore>,
    base_url: String,
}

impl OpenAiProvider {
    pub fn os() -> Self {
        Self::new(Arc::new(OsKeyring))
    }

    pub fn new(keys: Arc<dyn KeyStore>) -> Self {
        let (client, base_url) = (reqwest::Client::new(), "https://api.openai.com".into());
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
    if let Some(msg) = json_str(v, "/error/message") {
        return Err(ProviderError::Failed(msg.into()));
    }
    if let Some(m) = json_str(v, "/model") {
        *model = m.to_owned();
    }
    if v.pointer("/usage").is_some_and(Value::is_object) {
        u.input_tokens = json_u32(v, "/usage/prompt_tokens").unwrap_or(u.input_tokens);
        u.output_tokens = json_u32(v, "/usage/completion_tokens").unwrap_or(u.output_tokens);
        let cost = (f64::from(u.input_tokens) * 2.5 + f64::from(u.output_tokens) * 10.0) / 1e6;
        u.cost_usd = Some(cost);
    }
    Ok(json_str(v, "/choices/0/delta/content").map(str::to_owned))
}

#[async_trait::async_trait]
impl Provider for OpenAiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::OpenAi
    }

    fn capabilities(&self) -> Caps {
        chat_caps()
    }

    async fn health(&self) -> Health {
        self.keys.health(ProviderId::OpenAi, "OpenAI")
    }

    async fn chat(&self, req: ChatRequest, tx: Sender<ChatEvent>) -> Res<ChatSummary> {
        let key = self.keys.require_key(ProviderId::OpenAi)?;
        let m = req.options.model.as_deref().unwrap_or(DEFAULT_MODEL);
        let model = m.to_owned();
        let msg = json!({ "role": "user", "content": build_prompt(&req) });
        let body = json!({
            "model": model,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": [msg],
        });
        let http_req = self
            .client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .bearer_auth(key.expose())
            .json(&body);
        post_sse(http_req, &req, ProviderId::OpenAi, model, &tx, parse_sse).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::HealthStatus;
    use crate::http::{collect_chat, spawn_mock_http};
    use crate::keyring::MemoryKeyring;

    #[tokio::test]
    async fn openai_sse_keyring_and_redaction() {
        let fake = "FAKE_OPENAI_KEY_DO_NOT_USE";
        let keys = Arc::new(MemoryKeyring::default());
        let p = |u: String| OpenAiProvider::new(keys.clone()).with_base_url(u);
        let dead = p("http://127.0.0.1:9".into());
        assert_eq!(dead.health().await.status, HealthStatus::NoSession);
        let err_dead = collect_chat(&dead).await.unwrap_err();
        assert!(matches!(err_dead, ProviderError::Unavailable(_)));
        keys.set_key(ProviderId::OpenAi, fake).unwrap();
        let p_401 = p(spawn_mock_http(401, "{}").await);
        let err = collect_chat(&p_401).await.unwrap_err();
        assert!(!err.to_string().contains(fake));
        let sse = "data: {\"model\":\"gpt-4o-2024-08-06\",\"choices\":[{\"delta\":{\"content\":\"Hola \"}}]}\n\ndata: {\"model\":\"gpt-4o-2024-08-06\",\"choices\":[{\"delta\":{\"content\":\"OpenAI\"}}],\"usage\":{\"prompt_tokens\":80,\"completion_tokens\":12}}\n\ndata: [DONE]\n\n";
        let p_ok = p(spawn_mock_http(200, sse).await);
        assert_eq!(p_ok.health().await.status, HealthStatus::Ready);
        let (s, text) = collect_chat(&p_ok).await.unwrap();
        assert_eq!((s.usage.input_tokens, s.usage.output_tokens), (80, 12));
        assert_eq!(text, "Hola OpenAI");
    }
}
