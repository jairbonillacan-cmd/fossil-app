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
    CancelRegistry, CliKind, detect_binary, global_cancel_registry, is_safe_model,
    kill_process_tree, parse_ndjson_line,
};

/// Per-request working folder, removed when the request ends.
struct RequestDir(PathBuf);

impl RequestDir {
    fn create(id: &RequestId) -> Result<Self, ProviderError> {
        let dir = std::env::temp_dir().join(format!("fossil-bridge-{}", id.0));
        std::fs::create_dir(&dir).map_err(|e| ProviderError::Unavailable(e.to_string()))?;
        Ok(Self(dir))
    }
}

impl Drop for RequestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const DEFAULT_TIMEOUT_MS: u32 = 120_000;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const SCRUBBED_ENV_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
];

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

async fn read_bounded_line<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    buf: &mut Vec<u8>,
) -> Result<bool, ProviderError> {
    buf.clear();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|e| ProviderError::Failed(e.to_string()))?;
        if available.is_empty() {
            return Ok(!buf.is_empty());
        }
        if let Some(idx) = available.iter().position(|&b| b == b'\n') {
            if buf.len().saturating_add(idx) > MAX_LINE_BYTES {
                return Err(ProviderError::Failed(
                    "CLI output line exceeded maximum length".into(),
                ));
            }
            buf.extend_from_slice(&available[..idx]);
            reader.consume(idx + 1);
            return Ok(true);
        }
        if buf.len().saturating_add(available.len()) > MAX_LINE_BYTES {
            return Err(ProviderError::Failed(
                "CLI output line exceeded maximum length".into(),
            ));
        }
        buf.extend_from_slice(available);
        let len = available.len();
        reader.consume(len);
    }
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
        #[cfg(windows)]
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
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
        if let Some(hint) = req.options.model.as_deref().filter(|m| !m.is_empty())
            && !is_safe_model(hint)
        {
            return Err(ProviderError::Failed("invalid model name".into()));
        }
        let mut model = req
            .options
            .model
            .clone()
            .unwrap_or_else(|| def_model.into());

        let req_id = RequestId::new();
        // Empty working folder of its own per request: nothing another
        // process left behind is picked up by the CLI, and it is removed after.
        let cwd = RequestDir::create(&req_id)?;
        let mut cmd = Command::new(bin);
        for var in SCRUBBED_ENV_VARS {
            cmd.env_remove(var);
        }
        #[cfg(windows)]
        cmd.creation_flags(crate::CREATE_NO_WINDOW);
        let mut child = cmd
            .args(self.kind.cli_args(req.options.model.as_deref()))
            .current_dir(&cwd.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ProviderError::Unavailable(e.to_string()))?;

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
        let mut reader = BufReader::new(stdout);
        let mut raw_line = Vec::new();
        let (mut usage, mut started) = (Usage::default(), false);

        let res: Result<(), ProviderError> = async {
            loop {
                let has_line = tokio::select! {
                    biased;
                    () = tx.closed() => return Err(ProviderError::Cancelled),
                    r = timeout_at(d, read_bounded_line(&mut reader, &mut raw_line)) => {
                        r.map_err(|_| ProviderError::Timeout(ms))??
                    }
                };
                if !has_line {
                    break;
                }
                let line = String::from_utf8_lossy(&raw_line);
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
        let status = child
            .wait()
            .await
            .map_err(|e| ProviderError::Failed(e.to_string()))?;
        if !status.success() {
            return Err(ProviderError::Unavailable(format!(
                "{name} exited with status {status}"
            )));
        }

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
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT_ID: AtomicU32 = AtomicU32::new(0);

    #[tokio::test]
    async fn bridge_provider_streams_ndjson_from_headless_process() {
        let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "fossil-bridge-test-mock-{}-{seq}",
            std::process::id()
        ));
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

        let fail_script = dir.join("mock-fail.cmd");
        std::fs::write(&fail_script, "@echo off\r\nexit /b 1\r\n").unwrap();
        let fail_p = BridgeProvider::new(CliKind::Codex).with_binary(&fail_script);
        let (tx2, _rx2) = tokio::sync::mpsc::channel(16);
        assert!(matches!(
            fail_p.chat(ChatRequest::default(), tx2).await,
            Err(ProviderError::Unavailable(_))
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unsafe_model_names_never_reach_the_command_line() {
        let p = BridgeProvider::new(CliKind::Claude).with_binary("D:\\Acme\\missing-claude.exe");
        let mut req = ChatRequest::default();
        req.options.model = Some("sonnet & calc".into());
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let err = p.chat(req, tx).await.unwrap_err().to_string();
        assert!(err.contains("model"), "{err}");
    }
}
