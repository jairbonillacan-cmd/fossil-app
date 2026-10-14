//! Fossil local agent bridge (`#33`, ADR-0011, ADR-0013): detects `agy`, `claude`,
//! and `codex` on PATH, parses their headless NDJSON streams into `ChatEvent`
//! deltas/usage, and kills child process trees in < 500 ms on cancellation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};

use fossil_ai::{ProviderError, ProviderId, RequestId, Usage};
use serde_json::Value;

pub const CRATE_NAME: &str = "fossil-bridge";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CliKind {
    Agy,
    Claude,
    Codex,
}

impl CliKind {
    pub fn info(self) -> (ProviderId, &'static str, &'static str) {
        match self {
            Self::Agy => (ProviderId::Agy, "agy", "gemini-2.5-pro"),
            Self::Claude => (ProviderId::Claude, "claude", "claude-sonnet-4-20250514"),
            Self::Codex => (ProviderId::Codex, "codex", "gpt-5-codex"),
        }
    }

    pub fn cli_args(self, model: Option<&str>) -> Vec<String> {
        let base: &[&str] = match self {
            Self::Agy => &["-p", "--output-format", "stream-json"],
            Self::Claude => &["-p", "--output-format", "stream-json", "--verbose"],
            Self::Codex => &["exec", "--json", "--ephemeral", "--skip-git-repo-check"],
        };
        let mut args: Vec<String> = base.iter().map(|s| (*s).into()).collect();
        if let Some(m) = model.filter(|s| !s.is_empty()) {
            args.extend(["--model".into(), m.into()]);
        }
        if self == Self::Codex {
            args.push("-".into());
        }
        args
    }
}

type CancelHook = Box<dyn FnOnce() + Send>;
type CancelMap = HashMap<RequestId, (u32, Option<CancelHook>)>;

#[derive(Clone, Default)]
pub struct CancelRegistry(Arc<Mutex<CancelMap>>);

impl CancelRegistry {
    pub fn register(&self, id: RequestId, pid: u32) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(id, (pid, None));
    }

    pub fn register_with_hook(
        &self,
        id: RequestId,
        pid: u32,
        hook: impl FnOnce() + Send + 'static,
    ) {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(id, (pid, Some(Box::new(hook))));
    }

    pub fn remove(&self, id: &RequestId) -> Option<(u32, Option<CancelHook>)> {
        let mut map = self.0.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(id)
    }

    pub fn cancel(&self, id: &RequestId) -> bool {
        let Some((pid, hook)) = self.remove(id) else {
            return false;
        };
        if let Some(f) = hook {
            f();
        }
        if pid != 0 {
            kill_process_tree(pid);
        }
        true
    }
}

pub fn global_cancel_registry() -> &'static CancelRegistry {
    static REG: OnceLock<CancelRegistry> = OnceLock::new();
    REG.get_or_init(CancelRegistry::default)
}

pub fn kill_process_tree(pid: u32) {
    let (bin, args): (&str, [&str; 3]) = if cfg!(windows) {
        ("taskkill", ["/F", "/T", "/PID"])
    } else {
        ("kill", ["-9", "-9", "--"])
    };
    let _ = std::process::Command::new(bin)
        .args(args)
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

pub fn detect_binary(kind: CliKind) -> Option<PathBuf> {
    let (_, bin_name, _) = kind.info();
    let mut path_env = std::env::var_os("PATH").unwrap_or_default();
    if kind == CliKind::Agy
        && let Some(local) = std::env::var_os("LOCALAPPDATA")
    {
        let agy_dir = PathBuf::from(local).join("agy").join("bin");
        if let Ok(joined) =
            std::env::join_paths(std::env::split_paths(&path_env).chain(std::iter::once(agy_dir)))
        {
            path_env = joined;
        }
    }
    let out = std::process::Command::new("where.exe")
        .arg(bin_name)
        .env("PATH", path_env)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status.success().then(|| {
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(PathBuf::from)
    })?
}

fn json_str<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr).and_then(Value::as_str)
}

fn json_u32(v: &Value, ptr: &str) -> Option<u32> {
    v.pointer(ptr).and_then(Value::as_u64).map(|n| n as u32)
}

pub fn parse_ndjson_line(
    kind: CliKind,
    line: &str,
    model: &mut String,
    u: &mut Usage,
) -> Result<Option<String>, ProviderError> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return Ok(None);
    }
    let v: Value =
        serde_json::from_str(trimmed).map_err(|e| ProviderError::Failed(e.to_string()))?;
    let ty = json_str(&v, "/type").unwrap_or_default();

    match (kind, ty) {
        (CliKind::Claude, "system") => {
            if let Some(m) = json_str(&v, "/model") {
                *model = m.to_owned();
            }
            if json_str(&v, "/apiKeySource") == Some("none") {
                return Err(ProviderError::Unavailable("claude: Not logged in".into()));
            }
            Ok(None)
        }
        (CliKind::Claude, "assistant") => {
            if json_str(&v, "/error") == Some("authentication_failed") {
                return Err(ProviderError::Unavailable("claude: Not logged in".into()));
            }
            if let Some(m) = json_str(&v, "/message/model").filter(|m| !m.starts_with('<')) {
                *model = m.to_owned();
            }
            Ok(json_str(&v, "/message/content/0/text").map(str::to_owned))
        }
        (CliKind::Claude, "content_block_delta") => {
            Ok(json_str(&v, "/delta/text").map(str::to_owned))
        }
        (CliKind::Claude, "result") => {
            u.input_tokens = json_u32(&v, "/usage/input_tokens").unwrap_or(u.input_tokens);
            u.output_tokens = json_u32(&v, "/usage/output_tokens").unwrap_or(u.output_tokens);
            u.cost_usd = v.pointer("/total_cost_usd").and_then(Value::as_f64);
            if v.pointer("/is_error").and_then(Value::as_bool) == Some(true) {
                let msg = json_str(&v, "/result").unwrap_or("claude error");
                return if msg.contains("Not logged in") {
                    Err(ProviderError::Unavailable(msg.into()))
                } else {
                    Err(ProviderError::Failed(msg.into()))
                };
            }
            Ok(None)
        }
        (CliKind::Codex, "item.completed") => match json_str(&v, "/item/type") {
            Some("agent_message") => Ok(json_str(&v, "/item/text").map(str::to_owned)),
            _ => Ok(None),
        },
        (CliKind::Codex, "turn.completed") => {
            u.input_tokens = json_u32(&v, "/usage/input_tokens").unwrap_or(u.input_tokens);
            u.output_tokens = json_u32(&v, "/usage/output_tokens").unwrap_or(u.output_tokens);
            Ok(None)
        }
        (CliKind::Codex, "error" | "turn.failed") => {
            let msg = json_str(&v, "/message")
                .or_else(|| json_str(&v, "/error/message"))
                .unwrap_or("codex error");
            Err(ProviderError::Failed(msg.into()))
        }
        (CliKind::Agy, "init") => {
            if let Some(m) = json_str(&v, "/model") {
                *model = m.to_owned();
            }
            Ok(None)
        }
        (CliKind::Agy, "step_update") => Ok(json_str(&v, "/text_delta").map(str::to_owned)),
        (CliKind::Agy, "result") => {
            u.input_tokens = json_u32(&v, "/usage/input_tokens").unwrap_or(u.input_tokens);
            u.output_tokens = json_u32(&v, "/usage/output_tokens").unwrap_or(u.output_tokens);
            if v.pointer("/is_error").and_then(Value::as_bool) == Some(true) {
                return Err(ProviderError::Failed(
                    json_str(&v, "/error").unwrap_or("agy error").into(),
                ));
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use tokio::process::Command;

    fn run_fixture(kind: CliKind, raw: &str) -> Result<(String, Usage, String), ProviderError> {
        let mut model = kind.info().2.to_owned();
        let mut usage = Usage::default();
        let mut out = String::new();
        for line in raw.lines() {
            if let Some(d) = parse_ndjson_line(kind, line, &mut model, &mut usage)? {
                out.push_str(&d);
            }
        }
        Ok((model, usage, out))
    }

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }

    #[test]
    fn parses_spike_14_fixtures_for_claude_codex_and_agy() {
        let noauth = include_str!("../tests/fixtures/claude-stream-json-noauth.jsonl");
        assert!(matches!(
            run_fixture(CliKind::Claude, noauth),
            Err(ProviderError::Unavailable(_))
        ));
        let claude_ok = include_str!("../tests/fixtures/claude-stream-json-success.jsonl");
        let (m, u, text) = run_fixture(CliKind::Claude, claude_ok).unwrap();
        assert_eq!(
            (m.as_str(), text.as_str(), u.input_tokens, u.output_tokens),
            ("claude-sonnet-4-20250514", "PONG", 120, 4)
        );
        let codex_ok = include_str!("../tests/fixtures/codex-exec-json-success.jsonl");
        let (_, u_cx, text_cx) = run_fixture(CliKind::Codex, codex_ok).unwrap();
        assert_eq!(
            (text_cx.as_str(), u_cx.input_tokens, u_cx.output_tokens),
            ("PONG", 15963, 6)
        );
        let codex_bad = include_str!("../tests/fixtures/codex-exec-json-badmodel.jsonl");
        assert!(matches!(
            run_fixture(CliKind::Codex, codex_bad),
            Err(ProviderError::Failed(_))
        ));
        let agy_ok = include_str!("../tests/fixtures/agy-stream-json-success.jsonl");
        let (m_ag, u_ag, text_ag) = run_fixture(CliKind::Agy, agy_ok).unwrap();
        assert_eq!(
            (
                m_ag.as_str(),
                text_ag.as_str(),
                u_ag.input_tokens,
                u_ag.output_tokens
            ),
            ("gemini-2.5-pro", "PONG", 64, 3)
        );
    }

    #[tokio::test]
    async fn cancels_process_tree_under_500ms() {
        let mut child = Command::new("cmd.exe")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let (pid, reg, req_id) = (
            child.id().unwrap(),
            CancelRegistry::default(),
            RequestId::new(),
        );
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        reg.register_with_hook(req_id.clone(), pid, move || {
            let _ = tx.send(());
        });
        let waiter = tokio::spawn(async move {
            let _ = rx.await;
            let _ = child.kill().await;
            let _ = child.wait().await;
        });
        assert!(reg.cancel(&req_id));
        let t0 = Instant::now();
        waiter.await.unwrap();
        assert!(t0.elapsed() < Duration::from_millis(500));
    }
}
