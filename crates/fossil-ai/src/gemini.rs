//! Google Gemini API provider (`POST /v1beta/models/{model}:streamGenerateContent?alt=sse`, #32).

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::mpsc::Sender;

use crate::contract::{Caps, ChatEvent, ChatRequest, ChatSummary, Health, ProviderId, Usage};
use crate::http::{build_prompt, chat_caps, json_str, json_u32, post_sse};
use crate::keyring::{KeyStore, OsKeyring};
use crate::provider::{Provider, ProviderError};

const DEFAULT_MODEL: &str = "gemini-2.5-pro";
type Res<T> = Result<T, ProviderError>;

pub struct GeminiProvider {
    client: reqwest::Client,
    keys: Arc<dyn KeyStore>,
    base_url: String,
}

impl GeminiProvider {
    pub fn os() -> Self {
        Self::new(Arc::new(OsKeyring))
    }

    pub fn new(keys: Arc<dyn KeyStore>) -> Self {
        let base_url = "https://generativelanguage.googleapis.com".into();
        Self {
            client: reqwest::Client::new(),
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
    if let Some(m) = json_str(v, "/modelVersion") {
        *model = m.to_owned();
    }
    if v.pointer("/usageMetadata").is_some_and(Value::is_object) {
        let in_tok = json_u32(v, "/usageMetadata/promptTokenCount");
        let out_tok = json_u32(v, "/usageMetadata/candidatesTokenCount");
        u.input_tokens = in_tok.unwrap_or(u.input_tokens);
        u.output_tokens = out_tok.unwrap_or(u.output_tokens);
        let cost = (f64::from(u.input_tokens) * 1.25 + f64::from(u.output_tokens) * 10.0) / 1e6;
        u.cost_usd = Some(cost);
    }
    Ok(json_str(v, "/candidates/0/content/parts/0/text").map(str::to_owned))
}

#[async_trait::async_trait]
impl Provider for GeminiProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Gemini
    }

    fn capabilities(&self) -> Caps {
        chat_caps()
    }

    async fn health(&self) -> Health {
        self.keys.health(ProviderId::Gemini, "Gemini")
    }

    async fn chat(&self, req: ChatRequest, tx: Sender<ChatEvent>) -> Res<ChatSummary> {
        let key = self.keys.require_key(ProviderId::Gemini)?;
        let m = req.options.model.as_deref().unwrap_or(DEFAULT_MODEL);
        // The model name goes into the URL path: only plain name characters.
        let safe = !m.is_empty()
            && m.len() <= 128
            && m.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        if !safe {
            return Err(ProviderError::Failed("invalid Gemini model name".into()));
        }
        let model = m.to_owned();
        let url = format!(
            "{}/v1beta/models/{model}:streamGenerateContent?alt=sse",
            self.base_url
        );
        let body = json!({
            "contents": [{ "role": "user", "parts": [{ "text": build_prompt(&req) }] }]
        });
        let http_req = self
            .client
            .post(url)
            .header("x-goog-api-key", key.expose())
            .json(&body);
        post_sse(http_req, &req, ProviderId::Gemini, model, &tx, parse_sse).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::HealthStatus;
    use crate::http::{collect_chat, spawn_mock_http};
    use crate::keyring::MemoryKeyring;

    #[tokio::test]
    async fn gemini_sse_keyring_and_redaction() {
        let fake = "FAKE_GEMINI_KEY_DO_NOT_USE";
        let keys = Arc::new(MemoryKeyring::default());
        let p = |u: String| GeminiProvider::new(keys.clone()).with_base_url(u);
        let dead = p("http://127.0.0.1:9".into());
        assert_eq!(dead.health().await.status, HealthStatus::NoSession);
        keys.set_key(ProviderId::Gemini, fake).unwrap();
        let p_403 = p(spawn_mock_http(403, "{}").await);
        let err = collect_chat(&p_403).await.unwrap_err();
        assert!(!err.to_string().contains(fake));
        let sse = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hola Gemini\"}]}}],\"usageMetadata\":{\"promptTokenCount\":50,\"candidatesTokenCount\":8},\"modelVersion\":\"gemini-2.5-pro\"}\n\n";
        let p_ok = p(spawn_mock_http(200, sse).await);
        assert_eq!(p_ok.health().await.status, HealthStatus::Ready);
        let (s, text) = collect_chat(&p_ok).await.unwrap();
        assert_eq!((s.usage.input_tokens, s.usage.output_tokens), (50, 8));
        assert_eq!(text, "Hola Gemini");
    }

    #[tokio::test]
    async fn model_names_cannot_change_the_request_path() {
        let keys = Arc::new(MemoryKeyring::default());
        keys.set_key(ProviderId::Gemini, "FAKE_GEMINI_KEY_DO_NOT_USE")
            .unwrap();
        let sse = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"x\"}]}}]}\n\n";
        for model in ["../../other", "gemini?alt=x", "a#b", "a/b", "", "a b"] {
            let p =
                GeminiProvider::new(keys.clone()).with_base_url(spawn_mock_http(200, sse).await);
            let mut req = ChatRequest::default();
            req.options.model = Some(model.into());
            let (tx, _rx) = tokio::sync::mpsc::channel(16);
            assert!(p.chat(req, tx).await.is_err(), "{model:?} must be rejected");
        }
    }
}
