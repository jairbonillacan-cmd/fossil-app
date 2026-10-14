//! Local Ollama provider (`http://127.0.0.1:11434`, `GET /api/version`, `POST /api/chat`, #32).

use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::mpsc::Sender;

use crate::contract::{
    Caps, ChatEvent, ChatRequest, ChatSummary, Health, HealthStatus, ProviderId, Usage,
};
use crate::http::{build_prompt, json_str, json_u32, post_sse};
use crate::provider::{Provider, ProviderError};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";
const DEFAULT_MODEL: &str = "llama3.2";
type Res<T> = Result<T, ProviderError>;

pub struct OllamaProvider {
    client: reqwest::Client,
    base_url: String,
}

impl Default for OllamaProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl OllamaProvider {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: DEFAULT_BASE_URL.to_owned(),
        }
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into().trim_end_matches('/').to_owned();
        self
    }
}

fn parse_ndjson(v: &Value, model: &mut String, u: &mut Usage) -> Res<Option<String>> {
    if let Some(msg) = json_str(v, "/error") {
        return Err(ProviderError::Failed(msg.into()));
    }
    if let Some(m) = json_str(v, "/model") {
        *model = m.to_owned();
    }
    if v.pointer("/done").and_then(Value::as_bool) == Some(true) {
        u.input_tokens = json_u32(v, "/prompt_eval_count").unwrap_or(u.input_tokens);
        u.output_tokens = json_u32(v, "/eval_count").unwrap_or(u.output_tokens);
        u.cost_usd = Some(0.0);
    }
    Ok(json_str(v, "/message/content").map(str::to_owned))
}

#[async_trait::async_trait]
impl Provider for OllamaProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Ollama
    }

    fn capabilities(&self) -> Caps {
        Caps {
            chat: true,
            tools: true,
            embeddings: true,
            streaming: true,
            local: true,
        }
    }

    async fn health(&self) -> Health {
        let req = self
            .client
            .get(format!("{}/api/version", self.base_url))
            .timeout(Duration::from_millis(1_500));
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                let v: Value = resp.json().await.unwrap_or_default();
                Health {
                    status: HealthStatus::Ready,
                    version: json_str(&v, "/version").map(str::to_owned),
                    detail: Some("Ollama local server ready".into()),
                }
            }
            Ok(resp) => Health {
                status: HealthStatus::Error,
                version: None,
                detail: Some(format!("Ollama HTTP {}", resp.status().as_u16())),
            },
            Err(_) => Health {
                status: HealthStatus::NotInstalled,
                version: None,
                detail: Some("Ollama not reachable on 127.0.0.1:11434".into()),
            },
        }
    }

    async fn chat(&self, req: ChatRequest, tx: Sender<ChatEvent>) -> Res<ChatSummary> {
        let m = req.options.model.as_deref().unwrap_or(DEFAULT_MODEL);
        let model = m.to_owned();
        let msg = json!({ "role": "user", "content": build_prompt(&req) });
        let body = json!({ "model": model, "stream": true, "messages": [msg] });
        let http_req = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&body);
        post_sse(http_req, &req, ProviderId::Ollama, model, &tx, parse_ndjson).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::{collect_chat, spawn_mock_http};

    #[tokio::test]
    async fn ollama_lazy_health_and_ndjson_streaming() {
        let dead = OllamaProvider::new().with_base_url("http://127.0.0.1:9");
        assert_eq!(dead.health().await.status, HealthStatus::NotInstalled);
        let ver_url = spawn_mock_http(200, "{\"version\":\"0.6.2\"}").await;
        let h = OllamaProvider::new().with_base_url(ver_url).health().await;
        assert_eq!(
            (h.status, h.version.as_deref()),
            (HealthStatus::Ready, Some("0.6.2"))
        );
        let ndjson = "{\"model\":\"llama3.2\",\"message\":{\"role\":\"assistant\",\"content\":\"Hola \"},\"done\":false}\n{\"model\":\"llama3.2\",\"message\":{\"role\":\"assistant\",\"content\":\"Ollama\"},\"done\":true,\"prompt_eval_count\":34,\"eval_count\":7}\n";
        let chat_url = spawn_mock_http(200, ndjson).await;
        let p = OllamaProvider::new().with_base_url(chat_url);
        let (s, text) = collect_chat(&p).await.unwrap();
        assert_eq!((s.usage.input_tokens, s.usage.output_tokens), (34, 7));
        assert_eq!(s.usage.cost_usd, Some(0.0));
        assert_eq!(text, "Hola Ollama");
    }
}
