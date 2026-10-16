//! Windows Credential Manager storage for API provider keys (#32, ADR-0011).

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, RwLock};

use crate::contract::{Health, HealthStatus, ProviderId};
use crate::provider::ProviderError;

#[derive(Clone, PartialEq, Eq)]
pub struct SecretKey(String);

impl SecretKey {
    pub fn new(raw: impl Into<String>) -> Option<Self> {
        let s = raw.into().trim().to_owned();
        (!s.is_empty()).then_some(Self(s))
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretKey([REDACTED])")
    }
}

pub trait KeyStore: Send + Sync {
    fn get_key(&self, p: ProviderId) -> Result<Option<SecretKey>, ProviderError>;
    fn set_key(&self, p: ProviderId, key: &str) -> Result<(), ProviderError>;

    fn require_key(&self, p: ProviderId) -> Result<SecretKey, ProviderError> {
        self.get_key(p)?
            .ok_or_else(|| ProviderError::Unavailable(format!("missing {p:?} API key")))
    }

    fn health(&self, p: ProviderId, label: &str) -> Health {
        let (status, msg) = match self.get_key(p) {
            Ok(Some(_)) => (HealthStatus::Ready, format!("{label} API key configured")),
            Ok(None) => (HealthStatus::NoSession, format!("Missing {label} API key")),
            Err(e) => (HealthStatus::Error, e.to_string()),
        };
        Health {
            status,
            detail: Some(msg),
            ..Health::default()
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct OsKeyring;

fn os_entry(p: ProviderId) -> Result<keyring::Entry, ProviderError> {
    let name = match p {
        ProviderId::Anthropic => "anthropic-api-key",
        ProviderId::OpenAi => "openai-api-key",
        ProviderId::Gemini => "gemini-api-key",
        ProviderId::Agy | ProviderId::Claude | ProviderId::Codex | ProviderId::Ollama => {
            return Err(ProviderError::Failed(
                "provider does not use an API key".into(),
            ));
        }
    };
    keyring::Entry::new("com.fossil.ai", name)
        .map_err(|_| ProviderError::Unavailable("OS keyring unavailable".into()))
}

impl KeyStore for OsKeyring {
    fn get_key(&self, p: ProviderId) -> Result<Option<SecretKey>, ProviderError> {
        match os_entry(p)?.get_password() {
            Ok(raw) => Ok(SecretKey::new(raw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(ProviderError::Unavailable("keyring read failed".into())),
        }
    }

    fn set_key(&self, p: ProviderId, key: &str) -> Result<(), ProviderError> {
        let entry = os_entry(p)?;
        let s = SecretKey::new(key).ok_or_else(|| ProviderError::Failed("empty key".into()))?;
        entry
            .set_password(s.expose())
            .map_err(|_| ProviderError::Failed("write failed".into()))
    }
}

#[derive(Clone, Default)]
pub struct MemoryKeyring(Arc<RwLock<HashMap<ProviderId, SecretKey>>>);

impl KeyStore for MemoryKeyring {
    fn get_key(&self, p: ProviderId) -> Result<Option<SecretKey>, ProviderError> {
        let map = self.0.read().unwrap_or_else(|e| e.into_inner());
        Ok(map.get(&p).cloned())
    }

    fn set_key(&self, p: ProviderId, key: &str) -> Result<(), ProviderError> {
        let s = SecretKey::new(key).ok_or_else(|| ProviderError::Failed("empty key".into()))?;
        let mut map = self.0.write().unwrap_or_else(|e| e.into_inner());
        map.insert(p, s);
        Ok(())
    }
}
