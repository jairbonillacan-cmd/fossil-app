//! Headless child-process runner (`BridgeProvider`, `#33`, ADR-0011, ADR-0013).

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant as StdInstant};

use fossil_ai::{
    Caps, ChatContext, ChatEvent, ChatRequest, ChatSummary, Health, HealthStatus, Provider,
    ProviderError, ProviderId, RequestId, Usage,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::Sender;
use tokio::time::{Instant, timeout_at};

use crate::{
    CancelRegistry, CliKind, detect_binary, global_cancel_registry, kill_process_tree,
    parse_ndjson_line,
};

const DEFAULT_TIMEOUT_MS: u32 = 120_000;

fn format_prompt(req: &ChatRequest) -> String {
    let mut out = String::new();
    for item in &req.context {
        let tag = match item {
            ChatContext::Selection { text } => format!("<selection>\n{text}\n</selection>\n\n"),
            ChatContext::Page { object_id } => format!("<page id=\"{object_id}\" />\n\n"),
            ChatContext::Object { object_id } => format!("<object id=\"{object_id}\" />\n\n"),
        };
        out.push_str(&tag);
    }
    out + &req.prompt
}

async fn emit(tx: &Sender<ChatEvent>, ev: ChatEvent) -> Result<(), ProviderError> {
    tx.send(ev).await.map_err(|_| ProviderError::Cancelled)
}

pub struct BridgeProvider {
    kind: CliKind,
    bin_override: Option<PathBuf>,
    cancel_reg: CancelRegistry,
}

impl BridgeProvider {
    pub fn new(kind: CliKind) -> Self {
        Self {
            kind,
            bin_override: None,
            cancel_reg: global_cancel_registry().clone(),
        }
    }

    pub fn with_binary(mut self, bin: impl Into<PathBuf>) -> Self {
        self.bin_override = Some(bin.into());
        self
    }

    fn resolve_bin(&self) -> Option<PathBuf> {
        self.bin_override
            .clone()
            .or_else(|| detect_binary(self.kind))
    }
}

#[async_trait::async_trait]
impl Provider for BridgeProvider {
    fn id(&self) -> ProviderId {
        self.kind.info().0
    }

    fn capabilities(&self) -> Caps {
        Caps {
            chat: true,
            tools: true,
            streaming: true,
            ..Caps::default()
        }
    }

    async fn health(&self) -> Health {
        let (_, name, _) = self.kind.info();
        let Some(bin) = self.resolve_bin() else {
            return Health {
                status: HealthStatus::NotInstalled,
                version: None,
                detail: Some(format!("{name} not found on PATH")),
            };
        };
        let mut cmd = Command::new(bin);
        cmd.arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let d = Instant::now() + Duration::from_millis(3_000);
        match timeout_at(d, cmd.output()).await {
            Ok(Ok(o)) if o.status.success() => Health {
                status: HealthStatus::Ready,
                version: String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()
                    .map(|s| s.trim().into()),
                detail: None,
            },
            _ => Health {
                status: HealthStatus::Error,
                version: None,
                detail: Some(format!("{name} --version failed")),
            },
        }
    }

    async fn chat(
        &self,
        req: ChatRequest,
        tx: Sender<ChatEvent>,
    ) -> Result<ChatSummary, ProviderError> {
        let (id, name, def_model) = self.kind.info();
        let bin = self
            .resolve_bin()
            .ok_or_else(|| ProviderError::Unavailable(format!("{name} not installed")))?;
        let t0 = StdInstant::now();
        let ms = req.options.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
        let d = Instant::now() + Duration::from_millis(u64::from(ms));
        let mut model = req
            .options
            .model
            .clone()
            .unwrap_or_else(|| def_model.into());

        let cwd = std::env::temp_dir().join("fossil-bridge-cwd");
        let _ = std::fs::create_dir_all(&cwd);
        let mut child = Command::new(bin)
            .args(self.kind.cli_args(req.options.model.as_deref()))
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ProviderError::Unavailable(e.to_string()))?;

        let req_id = RequestId::new();
        let pid = child.id().unwrap_or(0);
        if pid != 0 {
            self.cancel_reg.register(req_id.clone(), pid);
        }
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format_prompt(&req).as_bytes()).await;
            drop(stdin);
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProviderError::Failed("missing stdout".into()))?;
        let mut lines = BufReader::new(stdout).lines();
        let (mut usage, mut started) = (Usage::default(), false);

        let res: Result<(), ProviderError> = async {
            while let Some(line) = timeout_at(d, lines.next_line())
                .await
                .map_err(|_| ProviderError::Timeout(ms))?
                .map_err(|e| ProviderError::Failed(e.to_string()))?
            {
                if tx.is_closed() {
                    return Err(ProviderError::Cancelled);
                }
                let delta = parse_ndjson_line(self.kind, &line, &mut model, &mut usage)?;
                if !started {
                    started = true;
                    let ev = ChatEvent::Started {
                        provider: id,
                        model: model.clone(),
                    };
                    emit(&tx, ev).await?;
                }
                if let Some(text) = delta.filter(|s| !s.is_empty()) {
                    emit(&tx, ChatEvent::Delta { text }).await?;
                }
            }
            Ok(())
        }
        .await;

        self.cancel_reg.remove(&req_id);
        if let Err(err) = res {
            if pid != 0 {
                kill_process_tree(pid);
            }
            let _ = child.wait().await;
            return Err(err);
        }
        let _ = child.wait().await;

        emit(&tx, ChatEvent::Usage(usage)).await?;
        let duration_ms = t0.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
        let summary = ChatSummary {
            request_id: req_id,
            provider: id,
            model,
            usage,
            duration_ms,
        };
        emit(
            &tx,
            ChatEvent::Done {
                summary: summary.clone(),
            },
        )
        .await?;
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bridge_provider_streams_ndjson_from_headless_process() {
        let dir = std::env::temp_dir().join("fossil-bridge-test-mock");
        let _ = std::fs::create_dir_all(&dir);
        let script = dir.join("mock-codex.cmd");
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("codex-exec-json-success.jsonl");
        let content = format!(
            "@echo off\r\nif \"%1\"==\"--version\" (\r\n  echo codex 0.162.1\r\n  exit /b 0\r\n)\r\ntype \"{}\"\r\n",
            fixture.display()
        );
        std::fs::write(&script, content).unwrap();

        let p = BridgeProvider::new(CliKind::Codex).with_binary(&script);
        let h = p.health().await;
        assert_eq!(h.status, HealthStatus::Ready);

        let (tx, mut rx) = tokio::sync::mpsc::channel(16);
        let s = p.chat(ChatRequest::default(), tx).await.unwrap();
        let mut text = String::new();
        while let Ok(ev) = rx.try_recv() {
            if let ChatEvent::Delta { text: d } = ev {
                text.push_str(&d);
            }
        }
        assert_eq!(text, "PONG");
        assert_eq!((s.usage.input_tokens, s.usage.output_tokens), (15963, 6));
    }
}
