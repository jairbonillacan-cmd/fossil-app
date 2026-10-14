//! Shared HTTP and Server-Sent Events (SSE) streaming helpers for API providers (#32).

use std::time::{Duration, Instant as StdInstant};

use serde_json::Value;
use tokio::sync::mpsc::Sender;
use tokio::time::{Instant, timeout_at};

use crate::contract::{
    Caps, ChatContext, ChatEvent, ChatRequest, ChatSummary, ProviderId, RequestId, Usage,
};
use crate::provider::ProviderError;

pub const DEFAULT_TIMEOUT_MS: u32 = 60_000;
pub type SseParser = fn(&Value, &mut String, &mut Usage) -> Result<Option<String>, ProviderError>;

pub fn chat_caps() -> Caps {
    Caps {
        chat: true,
        tools: true,
        streaming: true,
        ..Caps::default()
    }
}

pub fn json_str<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr).and_then(Value::as_str)
}

pub fn json_u32(v: &Value, ptr: &str) -> Option<u32> {
    v.pointer(ptr).and_then(Value::as_u64).map(|n| n as u32)
}

pub fn build_prompt(req: &ChatRequest) -> String {
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

pub async fn emit(tx: &Sender<ChatEvent>, event: ChatEvent) -> Result<(), ProviderError> {
    tx.send(event).await.map_err(|_| ProviderError::Cancelled)
}

pub async fn post_sse(
    req: reqwest::RequestBuilder,
    chat_req: &ChatRequest,
    id: ProviderId,
    mut model: String,
    tx: &Sender<ChatEvent>,
    on_frame: SseParser,
) -> Result<ChatSummary, ProviderError> {
    let t0 = StdInstant::now();
    let ms = chat_req.options.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let d = Instant::now() + Duration::from_millis(u64::from(ms));
    let to = |_| ProviderError::Timeout(ms);
    let me = |e: reqwest::Error| match (e.is_timeout(), e.is_connect()) {
        (true, _) => ProviderError::Timeout(ms),
        (_, true) => ProviderError::Unavailable("connection failed".into()),
        _ => ProviderError::Failed(e.without_url().to_string()),
    };

    let mut resp = timeout_at(d, req.send()).await.map_err(to)?.map_err(me)?;
    let code = resp.status().as_u16();
    if matches!(code, 401 | 403) {
        return Err(ProviderError::Unavailable(format!("{id:?} auth ({code})")));
    } else if !resp.status().is_success() {
        return Err(ProviderError::Failed(format!("{id:?} HTTP {code}")));
    }

    let (mut buf, mut usage, mut started) = (String::new(), Usage::default(), false);
    while let Some(b) = timeout_at(d, resp.chunk()).await.map_err(to)?.map_err(me)? {
        if tx.is_closed() {
            return Err(ProviderError::Cancelled);
        }
        buf.push_str(&String::from_utf8_lossy(&b));
        while let Some(idx) = buf.find('\n') {
            let line = buf[..idx].trim_end_matches('\r').to_owned();
            buf.drain(..=idx);
            let data = line.strip_prefix("data:").unwrap_or(&line).trim();
            if !data.starts_with('{') {
                continue;
            }
            let v: Value =
                serde_json::from_str(data).map_err(|e| ProviderError::Failed(e.to_string()))?;
            let delta = on_frame(&v, &mut model, &mut usage)?;
            if !started {
                started = true;
                let ev = ChatEvent::Started {
                    provider: id,
                    model: model.clone(),
                };
                emit(tx, ev).await?;
            }
            if let Some(text) = delta.filter(|s| !s.is_empty()) {
                emit(tx, ChatEvent::Delta { text }).await?;
            }
        }
    }

    emit(tx, ChatEvent::Usage(usage)).await?;
    let duration_ms = t0.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
    let summary = ChatSummary {
        request_id: RequestId::new(),
        provider: id,
        model,
        usage,
        duration_ms,
    };
    emit(
        tx,
        ChatEvent::Done {
            summary: summary.clone(),
        },
    )
    .await?;
    Ok(summary)
}

#[cfg(test)]
pub(crate) async fn spawn_mock_http(status: u16, body: &str) -> String {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    let resp = format!("HTTP/1.1 {status} OK\r\nConnection: close\r\n\r\n{body}");
    tokio::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        if let Ok((mut s, _)) = l.accept().await {
            let _ = s.read(&mut [0u8; 1024]).await;
            let _ = s.write_all(resp.as_bytes()).await;
        }
    });
    format!("http://{addr}")
}

#[cfg(test)]
pub(crate) async fn collect_chat(
    p: &dyn crate::provider::Provider,
) -> Result<(ChatSummary, String), ProviderError> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(16);
    let summary = p.chat(ChatRequest::default(), tx).await?;
    let mut text = String::new();
    while let Ok(ev) = rx.try_recv() {
        if let ChatEvent::Delta { text: d } = ev {
            text.push_str(&d);
        }
    }
    Ok((summary, text))
}
