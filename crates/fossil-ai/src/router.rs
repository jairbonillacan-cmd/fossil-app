//! AI Router (`#34`, spec §Router, ADR-0011): walks `RouteRule` fallback chains,
//! skips non-ready providers, and records token/cost usage in SQLite without prompts.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::{Connection, params};
use tokio::sync::{Notify, mpsc::Sender};

use crate::anthropic::AnthropicProvider;
use crate::contract::{
    AiError, Caps, ChatEvent, ChatRequest, ChatSummary, Health, HealthStatus, ProviderId,
    ProviderInfo, RequestId, RouteRule, TaskKind, Usage, default_routes,
};
use crate::gemini::GeminiProvider;
use crate::http::{build_prompt, chat_caps, redact_secrets};
use crate::ollama::OllamaProvider;
use crate::openai::OpenAiProvider;
use crate::provider::{Provider, ProviderError};

/// Default model identifier used when `ChatOptions::model` is `None`.
pub fn default_model(provider: ProviderId) -> &'static str {
    match provider {
        ProviderId::Agy | ProviderId::Gemini => "gemini-2.5-pro",
        ProviderId::Claude | ProviderId::Anthropic => "claude-sonnet-4-20250514",
        ProviderId::Codex | ProviderId::OpenAi => "gpt-4o",
        ProviderId::Ollama => "llama3.2",
    }
}

/// Estimates outgoing input tokens and USD cost (when the provider charges per token) before sending.
pub fn estimate_usage(req: &ChatRequest, provider: ProviderId) -> Usage {
    let chars = build_prompt(req).chars().count();
    let input_tokens = if chars == 0 {
        0
    } else {
        (chars.div_ceil(4)).min(u32::MAX as usize) as u32
    };
    let rate_per_m = match provider {
        ProviderId::Anthropic => Some(3.0),
        ProviderId::OpenAi => Some(2.5),
        ProviderId::Gemini => Some(1.25),
        ProviderId::Ollama => Some(0.0),
        ProviderId::Agy | ProviderId::Claude | ProviderId::Codex => None,
    };
    Usage {
        input_tokens,
        output_tokens: 0,
        cost_usd: rate_per_m.map(|r| (f64::from(input_tokens) * r) / 1e6),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct UsageRecord {
    pub request_id: RequestId,
    pub provider: ProviderId,
    pub model: String,
    pub task: TaskKind,
    pub usage: Usage,
    pub duration_ms: u32,
}

struct UnconfiguredCliProvider(ProviderId);

#[async_trait::async_trait]
impl Provider for UnconfiguredCliProvider {
    fn id(&self) -> ProviderId {
        self.0
    }
    fn capabilities(&self) -> Caps {
        chat_caps()
    }
    async fn health(&self) -> Health {
        Health {
            status: HealthStatus::NotInstalled,
            version: None,
            detail: Some(format!("{:?} CLI not detected", self.0)),
        }
    }
    async fn chat(
        &self,
        _req: ChatRequest,
        _tx: Sender<ChatEvent>,
    ) -> Result<ChatSummary, ProviderError> {
        Err(ProviderError::Unavailable(format!(
            "{:?} CLI not installed",
            self.0
        )))
    }
}

pub struct AiRouter {
    providers: HashMap<ProviderId, Arc<dyn Provider>>,
    db: Mutex<Option<Connection>>,
    in_flight: Mutex<HashMap<RequestId, Arc<Notify>>>,
}

impl Default for AiRouter {
    fn default() -> Self {
        Self::default_os()
    }
}

impl AiRouter {
    pub fn default_os() -> Self {
        let list: Vec<Arc<dyn Provider>> = vec![
            Arc::new(UnconfiguredCliProvider(ProviderId::Agy)),
            Arc::new(UnconfiguredCliProvider(ProviderId::Claude)),
            Arc::new(UnconfiguredCliProvider(ProviderId::Codex)),
            Arc::new(AnthropicProvider::os()),
            Arc::new(OpenAiProvider::os()),
            Arc::new(GeminiProvider::os()),
            Arc::new(OllamaProvider::new()),
        ];
        Self::new(list)
    }

    pub fn new(list: Vec<Arc<dyn Provider>>) -> Self {
        let conn = Connection::open_in_memory().ok();
        let providers = list.into_iter().map(|p| (p.id(), p)).collect();
        let router = Self {
            providers,
            db: Mutex::new(conn),
            in_flight: Mutex::new(HashMap::new()),
        };
        router.init_db();
        router
    }

    fn init_db(&self) {
        let guard = self.db.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(db) = guard.as_ref() {
            let _ = db.execute_batch(
                "CREATE TABLE IF NOT EXISTS ai_routes (idx INTEGER PRIMARY KEY, rule_json TEXT NOT NULL);
                 CREATE TABLE IF NOT EXISTS ai_usage (request_id TEXT PRIMARY KEY, task_json TEXT NOT NULL, summary_json TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL);",
            );
        }
        drop(guard);
        let _ = self.save_routes(&default_routes());
    }

    fn save_routes(&self, rules: &[RouteRule]) -> Result<(), AiError> {
        let guard = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let Some(db) = guard.as_ref() else {
            return Ok(());
        };
        let tx = db
            .unchecked_transaction()
            .map_err(|e| AiError::InvalidRoute(e.to_string()))?;
        tx.execute("DELETE FROM ai_routes", [])
            .map_err(|e| AiError::InvalidRoute(e.to_string()))?;
        for (idx, rule) in rules.iter().enumerate() {
            let json =
                serde_json::to_string(rule).map_err(|e| AiError::InvalidRoute(e.to_string()))?;
            tx.execute(
                "INSERT INTO ai_routes (idx, rule_json) VALUES (?1, ?2)",
                params![idx as i64, json],
            )
            .map_err(|e| AiError::InvalidRoute(e.to_string()))?;
        }
        tx.commit()
            .map_err(|e| AiError::InvalidRoute(e.to_string()))
    }

    pub fn routes_get(&self) -> Vec<RouteRule> {
        let guard = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let Some(db) = guard.as_ref() else {
            return default_routes();
        };
        let Ok(mut stmt) = db.prepare("SELECT rule_json FROM ai_routes ORDER BY idx ASC") else {
            return default_routes();
        };
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|r| r.ok().and_then(|s| serde_json::from_str(&s).ok()))
            .collect::<Vec<RouteRule>>();
        if rows.is_empty() {
            default_routes()
        } else {
            rows
        }
    }

    pub fn routes_set(&self, mut rules: Vec<RouteRule>) -> Result<(), AiError> {
        if rules.is_empty() {
            return Err(AiError::InvalidRoute("route table cannot be empty".into()));
        }
        let mut seen = HashSet::new();
        for rule in &mut rules {
            if !seen.insert(rule.task) {
                return Err(AiError::InvalidRoute(format!(
                    "duplicate task {:?}",
                    rule.task
                )));
            }
            let mut seen_providers = HashSet::new();
            rule.prefer.retain(|id| seen_providers.insert(*id));
            if rule.prefer.is_empty() {
                return Err(AiError::InvalidRoute(format!(
                    "empty chain for {:?}",
                    rule.task
                )));
            }
            if rule.task == TaskKind::Embedding {
                for &id in &rule.prefer {
                    let supports = self
                        .providers
                        .get(&id)
                        .is_some_and(|p| p.capabilities().embeddings)
                        || matches!(
                            id,
                            ProviderId::OpenAi | ProviderId::Gemini | ProviderId::Ollama
                        );
                    if !supports {
                        return Err(AiError::InvalidRoute(format!(
                            "{id:?} does not support embeddings"
                        )));
                    }
                }
            }
        }
        self.save_routes(&rules)
    }

    pub async fn providers(&self) -> Vec<ProviderInfo> {
        let mut out = Vec::with_capacity(ProviderId::all().len());
        for &id in ProviderId::all() {
            if let Some(p) = self.providers.get(&id) {
                let mut health = p.health().await;
                health.detail = health.detail.map(|d| redact_secrets(&d));
                out.push(ProviderInfo {
                    id,
                    caps: p.capabilities(),
                    health,
                });
            }
        }
        out
    }

    pub fn cancel(&self, request_id: &RequestId) -> bool {
        self.in_flight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(request_id)
            .inspect(|n| n.notify_waiters())
            .is_some()
    }

    pub async fn chat(
        &self,
        req: ChatRequest,
        tx: Sender<ChatEvent>,
    ) -> Result<ChatSummary, AiError> {
        self.chat_for_task(TaskKind::Chat, req, tx).await
    }

    pub async fn chat_for_task(
        &self,
        task: TaskKind,
        req: ChatRequest,
        tx: Sender<ChatEvent>,
    ) -> Result<ChatSummary, AiError> {
        self.chat_with_id(RequestId::new(), task, req, tx).await
    }

    pub async fn chat_with_id(
        &self,
        request_id: RequestId,
        task: TaskKind,
        req: ChatRequest,
        tx: Sender<ChatEvent>,
    ) -> Result<ChatSummary, AiError> {
        let notify = Arc::new(Notify::new());
        self.in_flight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(request_id.clone(), notify.clone());
        let candidates = if let Some(forced) = req.options.provider {
            vec![forced]
        } else {
            self.routes_get()
                .into_iter()
                .find(|r| r.task == task)
                .or_else(|| default_routes().into_iter().find(|r| r.task == task))
                .map(|r| r.prefer)
                .unwrap_or_default()
        };

        let mut last_err = None;
        let mut res = None;
        for id in candidates {
            let Some(p) = self.providers.get(&id) else {
                continue;
            };
            let caps = p.capabilities();
            let cap_ok = match task {
                TaskKind::Chat | TaskKind::Inline => caps.chat,
                TaskKind::Embedding => caps.embeddings,
            };
            if !cap_ok || p.health().await.status != HealthStatus::Ready {
                continue;
            }
            let outcome = tokio::select! {
                biased;
                () = notify.notified() => Err(ProviderError::Cancelled),
                out = p.chat(req.clone(), tx.clone()) => out,
            };
            match outcome {
                Ok(summary) => {
                    self.record_usage(task, &summary);
                    res = Some(Ok(summary));
                    break;
                }
                Err(ProviderError::Unavailable(msg)) => last_err = Some(redact_secrets(&msg)),
                Err(e) => {
                    res = Some(Err(AiError::ProviderFailure(redact_secrets(
                        &e.to_string(),
                    ))));
                    break;
                }
            }
        }
        self.in_flight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&request_id);
        res.unwrap_or_else(|| {
            Err(AiError::NoProvider(last_err.unwrap_or_else(|| {
                format!("no ready provider for {task:?}")
            })))
        })
    }

    fn record_usage(&self, task: TaskKind, s: &ChatSummary) {
        let guard = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let Some(db) = guard.as_ref() else {
            return;
        };
        let t_json = serde_json::to_string(&task).unwrap_or_default();
        let s_json = serde_json::to_string(s).unwrap_or_default();
        let _ = db.execute(
            "INSERT OR REPLACE INTO ai_usage (request_id, task_json, summary_json, input_tokens, output_tokens, cost_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![s.request_id.0, t_json, s_json, i64::from(s.usage.input_tokens), i64::from(s.usage.output_tokens), s.usage.cost_usd],
        );
    }

    pub fn usage_records(&self) -> Vec<UsageRecord> {
        let guard = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let Some(db) = guard.as_ref() else {
            return Vec::new();
        };
        let Ok(mut stmt) =
            db.prepare("SELECT task_json, summary_json FROM ai_usage ORDER BY rowid ASC")
        else {
            return Vec::new();
        };
        stmt.query_map([], |row| {
            let t_str: String = row.get(0)?;
            let s_str: String = row.get(1)?;
            Ok((t_str, s_str))
        })
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let (t_str, s_str) = r.ok()?;
            let task: TaskKind = serde_json::from_str(&t_str).ok()?;
            let s: ChatSummary = serde_json::from_str(&s_str).ok()?;
            Some(UsageRecord {
                request_id: s.request_id,
                provider: s.provider,
                model: s.model,
                task,
                usage: s.usage,
                duration_ms: s.duration_ms,
            })
        })
        .collect()
    }
}

pub fn global_router() -> &'static Arc<AiRouter> {
    static ROUTER: OnceLock<Arc<AiRouter>> = OnceLock::new();
    ROUTER.get_or_init(|| Arc::new(AiRouter::default_os()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::ChatContext;
    use crate::http::spawn_mock_http;
    use crate::keyring::{KeyStore, MemoryKeyring, OsKeyring};

    #[tokio::test]
    async fn router_fallback_skips_unready_and_logs_usage_without_prompt() {
        let keys = Arc::new(MemoryKeyring::default());
        keys.set_key(ProviderId::OpenAi, "FAKE_ROUTER_KEY").unwrap();
        let sse = "data: {\"model\":\"gpt-4o\",\"choices\":[{\"delta\":{\"content\":\"Respuesta\"}}],\"usage\":{\"prompt_tokens\":40,\"completion_tokens\":5}}\n\ndata: [DONE]\n\n";
        let oai_url = spawn_mock_http(200, sse).await;
        let router = AiRouter::new(vec![
            Arc::new(UnconfiguredCliProvider(ProviderId::Agy)),
            Arc::new(AnthropicProvider::new(keys.clone()).with_base_url("http://127.0.0.1:9")),
            Arc::new(OpenAiProvider::new(keys).with_base_url(oai_url)),
        ]);

        let bad_rule = RouteRule {
            task: TaskKind::Embedding,
            prefer: vec![ProviderId::Anthropic],
        };
        assert!(matches!(
            router.routes_set(vec![bad_rule]),
            Err(AiError::InvalidRoute(_))
        ));

        let dup_rule = RouteRule {
            task: TaskKind::Chat,
            prefer: vec![
                ProviderId::OpenAi,
                ProviderId::Anthropic,
                ProviderId::OpenAi,
            ],
        };
        router.routes_set(vec![dup_rule]).unwrap();
        assert_eq!(
            router.routes_get()[0].prefer,
            vec![ProviderId::OpenAi, ProviderId::Anthropic]
        );
        for p in [
            ProviderId::Ollama,
            ProviderId::Agy,
            ProviderId::Claude,
            ProviderId::Codex,
        ] {
            assert!(OsKeyring.get_key(p).is_err());
            assert!(OsKeyring.set_key(p, "k").is_err());
        }

        let secret_prompt = "CONFIDENTIAL_PROMPT_NEVER_PERSIST_12345";
        let req = ChatRequest {
            prompt: secret_prompt.into(),
            ..ChatRequest::default()
        };
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let summary = router.chat(req, tx).await.unwrap();
        assert_eq!(summary.provider, ProviderId::OpenAi);

        let logs = router.usage_records();
        assert_eq!(logs.len(), 1);
        assert_eq!(
            (logs[0].usage.input_tokens, logs[0].usage.output_tokens),
            (40, 5)
        );
        assert!(!format!("{logs:?}").contains(secret_prompt));
    }

    #[tokio::test]
    async fn estimate_usage_cancel_and_secret_redaction_work() {
        for &p in ProviderId::all() {
            assert!(!default_model(p).is_empty());
        }
        let req = ChatRequest {
            prompt: "Resume este párrafo".into(),
            context: vec![ChatContext::Selection {
                text: "Texto seleccionado".into(),
            }],
            ..ChatRequest::default()
        };
        assert!(
            estimate_usage(&req, ProviderId::Anthropic)
                .cost_usd
                .is_some()
        );
        assert_eq!(estimate_usage(&req, ProviderId::Ollama).cost_usd, Some(0.0));
        assert_eq!(estimate_usage(&req, ProviderId::Agy).cost_usd, None);

        let keys = Arc::new(MemoryKeyring::default());
        keys.set_key(ProviderId::Anthropic, "sk-ant-api03-FAKE_SECRET_1234567890")
            .unwrap();
        let err_sse = "data: {\"type\":\"error\",\"error\":{\"message\":\"leaked sk-proj-FAKE0123456789abcdef\"}}\n\n";
        let url = spawn_mock_http(200, err_sse).await;
        let router = Arc::new(AiRouter::new(vec![Arc::new(
            AnthropicProvider::new(keys).with_base_url(url),
        )]));
        assert!(!format!("{:?}", router.providers().await).contains("FAKE_SECRET_1234567890"));
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let err = router
            .chat(ChatRequest::default(), tx)
            .await
            .unwrap_err()
            .to_string();
        assert!(!err.contains("FAKE0123456789abcdef"));

        let req_id = RequestId::new();
        assert!(!router.cancel(&req_id));
        router
            .in_flight
            .lock()
            .unwrap()
            .insert(req_id.clone(), Arc::new(Notify::new()));
        assert!(router.cancel(&req_id));
        assert!(router.usage_records().is_empty());
    }
}
