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
    /// `None` only if the HTTP stack failed to start; every call then fails.
    client: Option<reqwest::Client>,
    base_url: String,
}

impl Default for OllamaProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl OllamaProvider {
    pub fn new() -> Self {
        // A local server must never bounce the page's text to another host.
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok();
        Self {
            client,
            base_url: DEFAULT_BASE_URL.to_owned(),
        }
    }

    /// Checked on every call by [`local_base`], so a non-local URL never gets a request.
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into().trim_end_matches('/').to_owned();
        self
    }

    fn client(&self) -> Res<(&reqwest::Client, String)> {
        let base = local_base(&self.base_url)?;
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| ProviderError::Unavailable("HTTP client unavailable".into()))?;
        Ok((client, base))
    }
}

/// `base_url` if it is plain http(s) on this machine: loopback host, no
/// credentials. Ollama is the local-only provider; anything else is refused.
fn local_base(base_url: &str) -> Res<String> {
    let refused =
        || ProviderError::Unavailable("Ollama base URL must be a local http address".into());
    let url = reqwest::Url::parse(base_url).map_err(|_| refused())?;
    let local_host = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if matches!(url.scheme(), "http" | "https")
        && local_host
        && url.username().is_empty()
        && url.password().is_none()
    {
        Ok(base_url.to_owned())
    } else {
        Err(refused())
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
        let (client, base) = match self.client() {
            Ok(pair) => pair,
            Err(e) => {
                return Health {
                    status: HealthStatus::Error,
                    version: None,
                    detail: Some(e.to_string()),
                };
            }
        };
        let req = client
            .get(format!("{base}/api/version"))
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
        let (client, base) = self.client()?;
        let http_req = client.post(format!("{base}/api/chat")).json(&body);
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

    /// Answers once with a redirect to `location`.
    async fn spawn_redirect(location: &str) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let resp = format!(
            "HTTP/1.1 302 Found\r\nLocation: {location}/api/chat\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            if let Ok((mut s, _)) = l.accept().await {
                let _ = s.read(&mut [0u8; 1024]).await;
                let _ = s.write_all(resp.as_bytes()).await;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn redirects_are_never_followed() {
        let ndjson = "{\"message\":{\"content\":\"elsewhere\"},\"done\":true}\n";
        let target = spawn_mock_http(200, ndjson).await;
        let p = OllamaProvider::new().with_base_url(spawn_redirect(&target).await);
        assert!(collect_chat(&p).await.is_err());
    }

    #[tokio::test]
    async fn only_local_base_urls_are_used() {
        for url in [
            "http://127.0.0.1@acme.invalid",
            "http://acme.invalid:11434",
            "http://user:secret@127.0.0.1:11434",
            "ftp://127.0.0.1:11434",
            "not a url",
        ] {
            let p = OllamaProvider::new().with_base_url(url);
            let err = collect_chat(&p).await.unwrap_err().to_string();
            assert!(err.contains("local"), "{url}: {err}");
            assert_eq!(p.health().await.status, HealthStatus::Error, "{url}");
        }
        for url in [
            "http://localhost:11434",
            "http://[::1]:11434",
            "https://127.0.0.1",
        ] {
            assert!(local_base(url).is_ok(), "{url}");
        }
    }
}
