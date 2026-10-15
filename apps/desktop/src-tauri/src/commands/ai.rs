//! Typed AI IPC surface (contract #16): `ai_*` commands and the `ai:event`
//! streaming event. Bodies are stubs until the registry (#32) and the bridge
//! (#33) land; signatures and wire types are final.

use fossil_ai::{AiError, ChatRequest, ProviderInfo, RequestId, RouteRule, default_routes};
use serde::{Deserialize, Serialize};

/// Streaming event of a chat request (`ai:event`), one per [`fossil_ai::ChatEvent`].
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "ai:event")]
pub struct AiEvent {
    pub request_id: RequestId,
    pub event: fossil_ai::ChatEvent,
}

macro_rules! stub {
    ($(#[$meta:meta])* $vis:vis async fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty) => {
        $(#[$meta])*
        #[tauri::command]
        #[specta::specta]
        #[allow(unused_variables)] // contract stubs: bodies arrive with #32/#33
        $vis async fn $name($($arg: $ty),*) -> $ret {
            Err(AiError::NotImplemented)
        }
    };
}

stub!(/// Lists every known provider with capabilities and (lazy) health.
    pub async fn ai_providers() -> Result<Vec<ProviderInfo>, AiError>);
stub!(/// Starts a chat request; the answer streams via `ai:event`.
    pub async fn ai_chat(req: ChatRequest) -> Result<RequestId, AiError>);
stub!(/// Cancels an in-flight request (the bridge kills the process tree).
    pub async fn ai_cancel(request_id: RequestId) -> Result<(), AiError>);
stub!(/// Replaces the route table after validating it.
    pub async fn ai_routes_set(rules: Vec<RouteRule>) -> Result<(), AiError>);

/// Reads the route table: the contract defaults until #32 persists user edits.
#[tauri::command]
#[specta::specta]
pub async fn ai_routes_get() -> Result<Vec<RouteRule>, AiError> {
    Ok(default_routes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_specta::Event;

    #[test]
    fn ai_event_is_named_ai_colon_event() {
        assert_eq!(AiEvent::NAME, "ai:event");
    }

    #[tokio::test]
    async fn stubs_report_not_implemented_and_routes_get_returns_defaults() {
        let err = AiError::NotImplemented;
        assert_eq!(ai_providers().await.unwrap_err(), err);
        assert_eq!(ai_chat(ChatRequest::default()).await.unwrap_err(), err);
        assert_eq!(ai_cancel(RequestId::default()).await.unwrap_err(), err);
        assert_eq!(ai_routes_set(vec![]).await.unwrap_err(), err);
        assert_eq!(ai_routes_get().await.unwrap(), default_routes());
    }
}
