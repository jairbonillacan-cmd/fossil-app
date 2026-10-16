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
pub const MAX_SSE_LINE_BYTES: usize = 1024 * 1024;
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

/// Replaces API keys echoed back by a provider (`sk-…`, `AIza…`) so an error
/// message shown in the UI or written to a log never carries a secret.
pub(crate) fn redact_secrets(text: &str) -> String {
    const PREFIXES: [(&str, usize); 2] = [("sk-", 8), ("AIza", 20)];
    let is_key_char = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    'scan: while let Some(c) = rest.chars().next() {
        let at_word_start = out.chars().next_back().is_none_or(|p| !is_key_char(p));
        if at_word_start {
            for (prefix, min_len) in PREFIXES {
                if let Some(after) = rest.strip_prefix(prefix) {
                    let len = after.find(|c: char| !is_key_char(c)).unwrap_or(after.len());
                    if len >= min_len {
                        out.push_str(prefix);
                        out.push_str("[redactado]");
                        rest = &after[len..];
                        continue 'scan;
                    }
                }
            }
        }
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

fn redact_error(error: ProviderError) -> ProviderError {
    match error {
        ProviderError::Failed(msg) => ProviderError::Failed(redact_secrets(&msg)),
        ProviderError::Unavailable(msg) => ProviderError::Unavailable(redact_secrets(&msg)),
        ProviderError::Unsupported(msg) => ProviderError::Unsupported(redact_secrets(&msg)),
        other => other,
    }
}

/// Streams an SSE/NDJSON response; every error it returns is redacted.
pub async fn post_sse(
    req: reqwest::RequestBuilder,
    chat_req: &ChatRequest,
    id: ProviderId,
    model: String,
    tx: &Sender<ChatEvent>,
    on_frame: SseParser,
) -> Result<ChatSummary, ProviderError> {
    stream_sse(req, chat_req, id, model, tx, on_frame)
        .await
        .map_err(redact_error)
}

async fn stream_sse(
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

    let mut resp = tokio::select! {
        biased;
        () = tx.closed() => return Err(ProviderError::Cancelled),
        res = timeout_at(d, req.send()) => res.map_err(to)?.map_err(me)?,
    };
    let code = resp.status().as_u16();
    if matches!(code, 401 | 403) {
        return Err(ProviderError::Unavailable(format!("{id:?} auth ({code})")));
    } else if !resp.status().is_success() {
        return Err(ProviderError::Failed(format!("{id:?} HTTP {code}")));
    }

    let (mut buf, mut usage, mut started) = (Vec::<u8>::new(), Usage::default(), false);
    loop {
        let maybe_chunk = tokio::select! {
            biased;
            () = tx.closed() => return Err(ProviderError::Cancelled),
            res = timeout_at(d, resp.chunk()) => res.map_err(to)?.map_err(me)?,
        };
        let Some(b) = maybe_chunk else { break };
        if buf.len().saturating_add(b.len()) > MAX_SSE_LINE_BYTES && !b.contains(&b'\n') {
            return Err(ProviderError::Failed(
                "SSE line exceeded maximum length".into(),
            ));
        }
        buf.extend_from_slice(&b);
        while let Some(idx) = buf.iter().position(|&c| c == b'\n') {
            if idx > MAX_SSE_LINE_BYTES {
                return Err(ProviderError::Failed(
                    "SSE line exceeded maximum length".into(),
                ));
            }
            let line = String::from_utf8_lossy(&buf[..idx])
                .trim_end_matches('\r')
                .to_owned();
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
        if buf.len() > MAX_SSE_LINE_BYTES {
            return Err(ProviderError::Failed(
                "SSE line exceeded maximum length".into(),
            ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn sse_split_multibyte_utf8_across_chunks_is_preserved() {
        let frame = b"data: {\"text\":\"\xC2\xA1Hola ni\xC3\xB1o \xF0\x9F\x9A\x80!\"}\n\n";
        let split_at = frame.windows(2).position(|w| w == [0xC3, 0xB1]).unwrap() + 1;
        let (part1, part2) = (frame[..split_at].to_vec(), frame[split_at..].to_vec());

        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut s, _)) = l.accept().await {
                let _ = s.read(&mut [0u8; 1024]).await;
                let _ = s
                    .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
                    .await;
                let _ = s.write_all(&part1).await;
                let _ = s.flush().await;
                tokio::time::sleep(Duration::from_millis(15)).await;
                let _ = s.write_all(&part2).await;
            }
        });

        let req = reqwest::Client::new().post(format!("http://{addr}"));
        let (tx, mut rx) = tokio::sync::mpsc::channel(16);
        let parser: SseParser = |v, _, _| Ok(json_str(v, "/text").map(str::to_owned));
        post_sse(
            req,
            &ChatRequest::default(),
            ProviderId::OpenAi,
            "m".into(),
            &tx,
            parser,
        )
        .await
        .unwrap();

        let mut out = String::new();
        while let Ok(ev) = rx.try_recv() {
            if let ChatEvent::Delta { text } = ev {
                out.push_str(&text);
            }
        }
        assert!(!out.contains('\u{FFFD}'));
        assert_eq!(out, "¡Hola niño 🚀!");
    }

    #[tokio::test]
    async fn provider_error_messages_never_echo_keys() {
        let keys = [
            "sk-ant-api03-FAKEabc123_def-456",
            "sk-proj-FAKE0123456789abcdef",
            "AIzaFAKE0123456789abcdefghijklmnop",
        ];
        for key in keys {
            let body = format!("data: {{\"error\":\"invalid key {key} for Acme\"}}\n\n");
            let url = spawn_mock_http(200, &body).await;
            let req = reqwest::Client::new().post(url);
            let (tx, _rx) = tokio::sync::mpsc::channel(16);
            let parser: SseParser = |v, _, _| {
                Err(ProviderError::Failed(
                    json_str(v, "/error").unwrap_or("").into(),
                ))
            };
            let err = post_sse(
                req,
                &ChatRequest::default(),
                ProviderId::OpenAi,
                "m".into(),
                &tx,
                parser,
            )
            .await
            .unwrap_err()
            .to_string();
            let secret = &key[key.len() - 8..];
            assert!(!err.contains(secret), "{err}");
            assert!(
                err.contains("for Acme"),
                "the rest of the message is kept: {err}"
            );
        }
        assert_eq!(redact_secrets("sin claves aquí"), "sin claves aquí");
        assert_eq!(redact_secrets("task-1 y skill"), "task-1 y skill");
    }
}
