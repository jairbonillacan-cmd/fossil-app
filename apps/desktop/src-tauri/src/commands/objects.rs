//! Object vault IPC contract (spec r1-objects-storage §Comandos IPC).
//!
//! Stub signatures fixed by contract #15: bodies return
//! [`CoreError::NotImplemented`] until their implementation issues (#17+)
//! land. Do not change signatures here without a `type:contract` issue.

use fossil_core::ids::ObjectId;
use fossil_core::objects::{
    BrokenLink, CoreError, Link, Mention, MetaPatch, NewObject, ObjectFilter, ObjectMeta,
    OutgoingLink, RenameReport,
};
use fossil_core::{
    attachments, doc_store, indexer, journal, mirror, object_store,
    vault::{VaultRecord, VaultSession},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::Manager;
use tauri_specta::Event;

pub struct VaultState(pub Mutex<VaultSession>);

/// Compacts an object's Yjs log after this long without new updates (#18).
pub const IDLE_COMPACTION: Duration = Duration::from_secs(30);

/// Markdown mirror (#21): an object's `.md` is written ~2 s after its last change.
pub const MIRROR_DELAY: Duration = Duration::from_secs(2);

/// Re-indexes an object (`blocks`, `links`, `tags`, `fts_objects`) 300 ms after its last change (#19).
pub const INDEX_DEBOUNCE: Duration = Duration::from_millis(300);

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

/// Debounce without polling: every change bumps the object's generation and
/// arms one timer; only the timer of the latest generation does the work.
#[derive(Default)]
pub struct Generations(Mutex<HashMap<String, u64>>);

#[derive(Default)]
pub struct IdleCompaction(pub Generations);

#[derive(Default)]
pub struct MirrorDebounce(pub Generations);

impl Generations {
    fn generations(&self) -> std::sync::MutexGuard<'_, HashMap<String, u64>> {
        // A panic while holding the lock leaves only counters behind: keep going.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn bump(&self, id: &str) -> u64 {
        let mut generations = self.generations();
        let next = NEXT_GENERATION.fetch_add(1, Ordering::Relaxed);
        generations.insert(id.to_owned(), next);
        next
    }

    fn take_if_latest(&self, id: &str, generation: u64) -> bool {
        let mut generations = self.generations();
        if generations.get(id) == Some(&generation) {
            generations.remove(id);
            true
        } else {
            false
        }
    }
}

pub(crate) fn with_session<T>(
    state: tauri::State<'_, VaultState>,
    action: impl FnOnce(&mut VaultSession) -> Result<T, CoreError>,
) -> Result<T, CoreError> {
    let mut session = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut session)
}

impl From<VaultRecord> for VaultInfo {
    fn from(vault: VaultRecord) -> Self {
        Self {
            path: vault.path,
            name: vault.name,
        }
    }
}

/// A vault known to this installation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "object:changed")]
pub struct ObjectChanged {
    pub id: ObjectId,
}

#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
#[tauri_specta(event_name = "index:updated")]
pub struct IndexUpdated {}

#[allow(unused_macros)]
macro_rules! stub {
    ($(#[$meta:meta])* $vis:vis fn $name:ident($($arg:ident: $ty:ty),*) -> $ret:ty) => {
        $(#[$meta])*
        #[tauri::command]
        #[specta::specta]
        #[allow(unused_variables)] // contract stubs: bodies arrive with #17+
        $vis fn $name($($arg: $ty),*) -> $ret {
            Err(CoreError::NotImplemented)
        }
    };
}

#[tauri::command]
#[specta::specta]
pub fn vault_open(
    state: tauri::State<'_, VaultState>,
    path: String,
) -> Result<VaultInfo, CoreError> {
    with_session(state, |session| {
        session.open(Path::new(&path)).map(Into::into)
    })
}

#[tauri::command]
#[specta::specta]
pub fn vault_create(
    state: tauri::State<'_, VaultState>,
    path: String,
    name: String,
) -> Result<VaultInfo, CoreError> {
    with_session(state, |session| {
        session.create(Path::new(&path), name).map(Into::into)
    })
}

#[tauri::command]
#[specta::specta]
pub fn vault_recent(state: tauri::State<'_, VaultState>) -> Result<Vec<VaultInfo>, CoreError> {
    with_session(state, |session| {
        Ok(session.recent()?.into_iter().map(Into::into).collect())
    })
}

#[tauri::command]
#[specta::specta]
pub fn object_get(
    state: tauri::State<'_, VaultState>,
    id: ObjectId,
) -> Result<Option<ObjectMeta>, CoreError> {
    with_session(state, |session| {
        session.with_connection(|conn| object_store::get(conn, &id))
    })
}

#[tauri::command]
#[specta::specta]
pub fn object_list(
    state: tauri::State<'_, VaultState>,
    filter: ObjectFilter,
) -> Result<Vec<ObjectMeta>, CoreError> {
    with_session(state, |session| {
        session.with_connection(|conn| object_store::list(conn, filter))
    })
}

pub(crate) fn changed(app: &tauri::AppHandle, meta: ObjectMeta) -> ObjectMeta {
    // Persistence already succeeded; a disconnected event listener must not turn it into a failed edit.
    let _ = ObjectChanged {
        id: meta.id.clone(),
    }
    .emit(app);
    schedule_mirror(app, meta.id.clone(), true);
    schedule_index(app, meta.id.clone());
    meta
}

/// Debounced re-index (#19). Shares the idle-compaction generations under an
/// `index:` key prefix, so it needs no extra managed state.
fn schedule_index(app: &tauri::AppHandle, id: ObjectId) {
    let (app, key) = (app.clone(), format!("index:{}", id.0));
    let generation = app.state::<IdleCompaction>().0.bump(&key);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(INDEX_DEBOUNCE).await;
        if app
            .state::<IdleCompaction>()
            .0
            .take_if_latest(&key, generation)
            && with_session(app.state::<VaultState>(), |session| {
                session.with_connection(|conn| indexer::index_object(conn, &id))
            })
            .is_ok()
        {
            let _ = IndexUpdated {}.emit(&app);
        }
    });
}

fn schedule_mirror(app: &tauri::AppHandle, id: ObjectId, tree: bool) {
    // Body edits get their own key so they never cancel a pending export_tree.
    let key = if tree {
        id.0.clone()
    } else {
        format!("body:{}", id.0)
    };
    let generation = app.state::<MirrorDebounce>().0.bump(&key);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(MIRROR_DELAY).await;
        if !app
            .state::<MirrorDebounce>()
            .0
            .take_if_latest(&key, generation)
        {
            return;
        }
        let result = with_session(app.state::<VaultState>(), |session| {
            let Some(root) = session.root().map(Path::to_path_buf) else {
                return Ok(());
            };
            // export_tree on metadata changes moves children; body edits only export the page itself.
            session.with_connection(|conn| {
                if tree {
                    mirror::export_tree(conn, &root, &id)
                } else {
                    mirror::export(conn, &root, &id).map(|_| ())
                }
            })
        });
        // Export only (ADR-0004): a failed write never touches the vault data.
        if let Err(error) = result {
            eprintln!("markdown mirror failed for {}: {error}", id.0);
        }
    });
}

#[tauri::command]
#[specta::specta]
pub fn object_create(
    state: tauri::State<'_, VaultState>,
    app: tauri::AppHandle,
    meta: NewObject,
) -> Result<ObjectMeta, CoreError> {
    let meta = with_session(state, |session| {
        session.with_connection(|conn| object_store::create(conn, meta))
    })?;
    Ok(changed(&app, meta))
}

#[tauri::command]
#[specta::specta]
pub fn object_update_meta(
    state: tauri::State<'_, VaultState>,
    app: tauri::AppHandle,
    id: ObjectId,
    patch: MetaPatch,
) -> Result<ObjectMeta, CoreError> {
    let meta = with_session(state, |session| {
        session.with_connection(|conn| object_store::update(conn, &id, patch))
    })?;
    Ok(changed(&app, meta))
}

#[tauri::command]
#[specta::specta]
pub fn object_archive(
    state: tauri::State<'_, VaultState>,
    app: tauri::AppHandle,
    id: ObjectId,
) -> Result<ObjectMeta, CoreError> {
    let meta = with_session(state, |session| {
        session.with_connection(|conn| object_store::archive(conn, &id))
    })?;
    Ok(changed(&app, meta))
}

#[tauri::command]
#[specta::specta]
pub fn object_move(
    state: tauri::State<'_, VaultState>,
    app: tauri::AppHandle,
    id: ObjectId,
    parent: Option<ObjectId>,
) -> Result<ObjectMeta, CoreError> {
    let meta = with_session(state, |session| {
        session.with_connection(|conn| object_store::move_object(conn, &id, parent))
    })?;
    Ok(changed(&app, meta))
}
#[tauri::command]
#[specta::specta]
pub fn object_load_doc(
    state: tauri::State<'_, VaultState>,
    id: ObjectId,
) -> Result<Vec<u8>, CoreError> {
    with_session(state, |session| {
        session.with_connection(|conn| doc_store::load(conn, &id))
    })
}

#[tauri::command]
#[specta::specta]
pub fn object_apply_update(
    state: tauri::State<'_, VaultState>,
    idle: tauri::State<'_, IdleCompaction>,
    app: tauri::AppHandle,
    id: ObjectId,
    update: Vec<u8>,
) -> Result<(), CoreError> {
    with_session(state, |session| {
        session.with_connection(|conn| doc_store::apply_update(conn, &id, &update))
    })?;
    schedule_idle_compaction(app.clone(), id.clone(), idle.0.bump(&id.0));
    schedule_mirror(&app, id.clone(), false);
    schedule_index(&app, id.clone());
    // Persistence already succeeded; a disconnected listener must not fail the edit.
    let _ = ObjectChanged { id }.emit(&app);
    Ok(())
}

/// The page as Markdown, exactly what the vault mirror writes (#126).
#[tauri::command]
#[specta::specta]
pub fn object_export_markdown(
    state: tauri::State<'_, VaultState>,
    id: ObjectId,
) -> Result<String, CoreError> {
    with_session(state, |session| {
        session.with_connection(|conn| mirror::render_object(conn, &id))
    })
}

fn schedule_idle_compaction(app: tauri::AppHandle, id: ObjectId, generation: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_COMPACTION).await;
        if !app
            .state::<IdleCompaction>()
            .0
            .take_if_latest(&id.0, generation)
        {
            return;
        }
        // Best effort: an uncompacted log is still complete, it only loads slower.
        let _ = with_session(app.state::<VaultState>(), |session| {
            session.with_connection(|conn| doc_store::compact(conn, &id))
        });
    });
}

#[tauri::command]
#[specta::specta]
pub fn links_backlinks(
    s: tauri::State<'_, VaultState>,
    id: ObjectId,
) -> Result<Vec<Link>, CoreError> {
    with_session(s, |s| s.with_connection(|c| indexer::backlinks(c, &id)))
}

/// Links leaving `id`, resolved or not, for the outgoing links panel.
#[tauri::command]
#[specta::specta]
pub fn links_outgoing(
    s: tauri::State<'_, VaultState>,
    id: ObjectId,
) -> Result<Vec<OutgoingLink>, CoreError> {
    with_session(s, |s| {
        s.with_connection(|c| indexer::outgoing_links(c, &id))
    })
}

#[tauri::command]
#[specta::specta]
pub fn links_unlinked_mentions(
    s: tauri::State<'_, VaultState>,
    id: ObjectId,
) -> Result<Vec<Mention>, CoreError> {
    with_session(s, |s| {
        s.with_connection(|c| indexer::unlinked_mentions(c, &id))
    })
}

stub!(
    /// Renames `id` and rewrites every inbound wikilink in the Yjs documents
    /// of the pages that hold them (r1-safe-rename, #128; engine in #135).
    /// One `Immediate` transaction: on any error nothing is written. Title-form
    /// links become `[[<new title>]]` (alias and `#block` kept); if the new
    /// title is shared with another non-archived object or holds `|` or `#`,
    /// they become id-form `[[<id>|<new title>]]` so they never turn ambiguous.
    /// Id-form links keep their id and only change an alias equal to the old
    /// title. Archived source pages and self-links are rewritten too; an
    /// archived object can be renamed. Same title: no-op, zero counts.
    /// Errors: `ObjectNotFound`, `InvalidTitle`. Emits `object:changed` for the
    /// object and every rewritten page, and re-indexes them.
    pub fn object_rename(id: ObjectId, title: String) -> Result<RenameReport, CoreError>
);
stub!(
    /// Wikilinks pointing to `id` from other pages, one per linking block,
    /// archived source pages included (unlike `links_backlinks`); self-links do
    /// not count. Ask it before archiving, moving or deleting. `ObjectNotFound`
    /// if `id` does not exist.
    pub fn links_inbound_count(id: ObjectId) -> Result<u32, CoreError>
);
stub!(
    /// Wikilinks of non-archived pages that do not resolve to exactly one
    /// non-archived object (`Missing`, `Archived` or `Ambiguous`), self-links
    /// included; ordered by source page `updated_at DESC`, then block order.
    pub fn links_broken() -> Result<Vec<BrokenLink>, CoreError>
);

/// Opens (or creates with its template) today's journal (#22).
#[tauri::command]
#[specta::specta]
pub fn journal_today(
    state: tauri::State<'_, VaultState>,
    app: tauri::AppHandle,
) -> Result<ObjectMeta, CoreError> {
    let (meta, created) = with_session(state, |session| session.with_connection(journal::today))?;
    Ok(if created { changed(&app, meta) } else { meta })
}

fn vault_root(session: &VaultSession) -> Result<std::path::PathBuf, CoreError> {
    session
        .root()
        .map(Path::to_path_buf)
        .ok_or(CoreError::VaultNotOpen)
}

/// Stores a pasted or dropped image in `<vault>/attachments/` and returns its
/// vault-relative path for the document to reference (#110).
#[tauri::command]
#[specta::specta]
pub fn attachment_save(
    state: tauri::State<'_, VaultState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, CoreError> {
    let root = with_session(state, |session| vault_root(session))?;
    // File I/O outside the session lock: a 20 MB image must not stall other commands.
    attachments::save(&root, &file_name, &bytes)
}

/// Reads an attachment by the path `attachment_save` returned (#110).
#[tauri::command]
#[specta::specta]
pub fn attachment_load(
    state: tauri::State<'_, VaultState>,
    path: String,
) -> Result<Vec<u8>, CoreError> {
    let root = with_session(state, |session| vault_root(session))?;
    attachments::load(&root, &path)
}

#[cfg(test)]
mod tests {
    use super::{CoreError, Generations, IndexUpdated, ObjectChanged};

    #[test]
    fn only_the_latest_update_compacts_when_idle() {
        let idle = Generations::default();
        let first = idle.bump("a");
        let second = idle.bump("a");
        let other = idle.bump("b");
        assert!(
            !idle.take_if_latest("a", first),
            "a newer update superseded it"
        );
        assert!(idle.take_if_latest("a", second));
        assert!(!idle.take_if_latest("a", second), "fires at most once");
        let third = idle.bump("a");
        assert!(
            third > second,
            "generation never resets to 1 after removal (ABA-safe)"
        );
        assert!(idle.take_if_latest("b", other));
    }

    #[test]
    fn stubs_return_not_implemented() {
        stub!(fn pending() -> Result<(), CoreError>);
        let error = pending().unwrap_err();
        assert_eq!(error, CoreError::NotImplemented);
        let id = fossil_core::ids::ObjectId::new;
        let errors = [
            super::object_rename(id(), "Plan Acme".into()).err(),
            super::links_inbound_count(id()).err(),
            super::links_broken().err(),
        ];
        assert!(errors.iter().all(|e| e == &Some(CoreError::NotImplemented)));
    }

    #[test]
    fn object_changed_serializes_its_payload() {
        let event = ObjectChanged {
            id: fossil_core::ids::ObjectId::new(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert!(json.get("id").is_some());
        assert!(serde_json::to_value(IndexUpdated {}).unwrap().is_object());
    }
}
