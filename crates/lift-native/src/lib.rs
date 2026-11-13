//! Native engine, SQLite persistence, legacy migration and UniFFI bindings.
uniffi::setup_scaffolding!();

#[derive(uniffi::Record)]
pub struct EngineInfo {
    pub protocol_version: u32,
    pub engine_version: String,
}

#[derive(uniffi::Record)]
pub struct WeightResult {
    pub kilograms: f64,
    pub pounds: f64,
    pub comparison_key: f64,
}

#[uniffi::export]
pub fn engine_info() -> EngineInfo {
    EngineInfo {
        protocol_version: 1,
        engine_version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[uniffi::export]
pub fn inspect_weight(kilograms: Option<f64>) -> WeightResult {
    use lift_domain::units::{from_kg, weight_key, WeightUnit};
    WeightResult {
        kilograms: from_kg(kilograms, WeightUnit::Kg),
        pounds: from_kg(kilograms, WeightUnit::Lb),
        comparison_key: weight_key(kilograms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_contract() {
        assert_eq!(engine_info().protocol_version, 1);
        assert_eq!(inspect_weight(Some(56.699)).comparison_key, 5670.0);
        assert_eq!(inspect_weight(None).kilograms, 0.0);
    }
}

/// Transitional read-only boundary for clients that still own the legacy
/// dataset. Export processing runs on the native queue without opening or
/// writing a second account store. Removed after the full session cutover.
#[uniffi::export]
pub fn export_legacy_fitnotes(
    snapshot_json: String,
    skeleton: Vec<u8>,
    now: String,
) -> Result<Vec<u8>, EngineError> {
    let mut snapshot: lift_domain::model::Snapshot =
        serde_json::from_str(&snapshot_json).map_err(|e| bridge_error(e.to_string()))?;
    lift_domain::model::repair(&mut snapshot);
    lift_domain::model::validate(&snapshot).map_err(bridge_error)?;
    fitnotes_export::build(&snapshot, &skeleton, &now).map_err(bridge_error)
}

#[uniffi::export]
pub fn export_legacy_json(
    snapshot_json: String,
    username: String,
    now: String,
) -> Result<String, EngineError> {
    let mut snapshot: lift_domain::model::Snapshot =
        serde_json::from_str(&snapshot_json).map_err(|e| bridge_error(e.to_string()))?;
    lift_domain::model::repair(&mut snapshot);
    lift_domain::model::validate(&snapshot).map_err(bridge_error)?;
    serde_json::to_string_pretty(&lift_codec::export::user_json(&snapshot, &username, &now))
        .map_err(|e| bridge_error(e.to_string()))
}

mod error;
mod fitnotes_export;
mod migration;
mod rows;
mod storage;
use error::{Fail, Kind};

#[derive(uniffi::Record)]
pub struct UploadSnapshot {
    pub bytes: Vec<u8>,
    pub generation: u64,
    pub revision: u64,
    pub etag: Option<String>,
    pub device_id: String,
}

#[derive(uniffi::Record, serde::Deserialize)]
pub struct ImportRequest {
    pub command_id: String,
    pub generation: u64,
    pub revision: u64,
    pub format: String,
    pub text: String,
    pub replace: bool,
    pub now: String,
    pub today: String,
}

/// Each variant is one stable JavaScript error code (see LiftEngineModule).
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum EngineError {
    /// ERR_ENGINE: anything else.
    #[error("{details}")]
    Failed { details: String },
    /// ERR_ENGINE_TOO_NEW: data or a database from a newer build; nothing
    /// was written.
    #[error("{details}")]
    TooNew { details: String },
    /// ERR_ENGINE_CORRUPT: no readable copy of the data.
    #[error("{details}")]
    Corrupt { details: String },
    /// ERR_ENGINE_STALE: based on an older generation or revision.
    #[error("{details}")]
    Stale { details: String },
    /// ERR_ENGINE_CLOSED: the session is closed.
    #[error("{details}")]
    Closed { details: String },
}
fn bridge_error(message: String) -> EngineError {
    EngineError::Failed { details: message }
}
impl From<Fail> for EngineError {
    fn from(f: Fail) -> Self {
        let details = f.message;
        match f.kind {
            Kind::TooNew => Self::TooNew { details },
            Kind::Corrupt => Self::Corrupt { details },
            Kind::Stale => Self::Stale { details },
            Kind::Closed => Self::Closed { details },
            Kind::Other => Self::Failed { details },
        }
    }
}
fn closed() -> EngineError {
    EngineError::Closed {
        details: "Engine closed".into(),
    }
}
/// Query errors that mean the caller's view is out of date.
fn query_error(message: String) -> EngineError {
    if message.contains("restart pagination") {
        EngineError::Stale { details: message }
    } else {
        bridge_error(message)
    }
}

/// The Expo wrapper schedules calls onto its serial worker queue. The mutex
/// prevents concurrent host calls from observing prepared, uncommitted state.
/// Gzip work for uploads, restore points and replacements runs outside it on
/// a snapshot captured under it (tables are shared, so capturing is cheap).
#[derive(uniffi::Object)]
pub struct NativeEngine {
    store: std::sync::Mutex<Option<storage::Store>>,
    path: String,
    device_id: String,
}
type Guard<'a> = std::sync::MutexGuard<'a, Option<storage::Store>>;
impl NativeEngine {
    /// The store lock. After a panic the lock is recovered and the store is
    /// reloaded from disk, since in-memory state may be half updated; if the
    /// reload fails the session is closed.
    fn guard(&self) -> Guard<'_> {
        match self.store.lock() {
            Ok(g) => g,
            Err(poison) => {
                let mut g = poison.into_inner();
                self.store.clear_poison();
                if g.is_some() {
                    *g = None;
                    *g = storage::Store::open(&self.path, self.device_id.clone(), now_iso()).ok();
                }
                g
            }
        }
    }
    fn with<T>(
        &self,
        f: impl FnOnce(&storage::Store) -> Result<T, Fail>,
    ) -> Result<T, EngineError> {
        let g = self.guard();
        let store = g.as_ref().ok_or_else(closed)?;
        Ok(f(store)?)
    }
    fn with_mut<T>(
        &self,
        f: impl FnOnce(&mut storage::Store) -> Result<T, Fail>,
    ) -> Result<T, EngineError> {
        let mut g = self.guard();
        let store = g.as_mut().ok_or_else(closed)?;
        Ok(f(store)?)
    }
}
fn now_iso() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    lift_domain::prs::iso_from_ms(ms).unwrap_or_default()
}
fn json_text(v: &impl serde::Serialize) -> Result<String, EngineError> {
    serde_json::to_string(v).map_err(|e| bridge_error(e.to_string()))
}
/// Opens the store, migrating legacy files first and falling back to the
/// newest restore point when the database itself is damaged.
fn open_store(
    path: &str,
    device_id: &str,
    now: &str,
    legacy: &migration::Legacy,
) -> Result<storage::Store, Fail> {
    let target = std::path::Path::new(path);
    migration::migrate_if_needed(target, device_id, now, legacy)?;
    match storage::Store::open(path, device_id.into(), now.into()) {
        Err(f) if f.kind == Kind::Corrupt && target.exists() => {
            migration::recover_from_backups(target, device_id, now).map_err(|r| {
                if r.kind == Kind::TooNew {
                    r
                } else {
                    Fail::corrupt(format!("{} ({})", f.message, r.message))
                }
            })?;
            storage::Store::open(path, device_id.into(), now.into())
        }
        other => other,
    }
}
#[uniffi::export]
impl NativeEngine {
    /// `legacy_json` is `{"etag": string|null}`: the cloud version the
    /// legacy store last agreed with. It is adopted only when this open
    /// migrates the legacy store into a new database.
    #[uniffi::constructor]
    pub fn open(
        path: String,
        device_id: String,
        now: String,
        legacy_json: String,
    ) -> Result<std::sync::Arc<Self>, EngineError> {
        let legacy = migration::Legacy::parse(&legacy_json);
        let store = open_store(&path, &device_id, &now, &legacy)?;
        Ok(std::sync::Arc::new(Self {
            store: std::sync::Mutex::new(Some(store)),
            path,
            device_id,
        }))
    }
    pub fn execute(
        &self,
        command_id: String,
        generation: u64,
        command_json: String,
        now: String,
        today: String,
    ) -> Result<String, EngineError> {
        let command =
            serde_json::from_str(&command_json).map_err(|e| bridge_error(e.to_string()))?;
        let receipt = self.with_mut(|s| s.execute(command_id, generation, command, now, today))?;
        json_text(&receipt)
    }
    pub fn import_file_json(&self, request_json: String) -> Result<String, EngineError> {
        let request =
            serde_json::from_str(&request_json).map_err(|e| bridge_error(e.to_string()))?;
        self.import_file(request)
    }
    pub fn import_file(&self, request: ImportRequest) -> Result<String, EngineError> {
        // A replacing import keeps the data it replaces as undo. That copy is
        // encoded outside the lock from a snapshot captured inside it.
        let capture = self.with(|s| {
            Ok(
                if request.replace && s.receipt(&request.command_id)?.is_none() {
                    Some(s.capture())
                } else {
                    None
                },
            )
        })?;
        let undo = match capture {
            Some(c) => Some((
                c.encode(&request.now)?,
                c.metadata(&request.now),
                c.generation,
                c.revision,
            )),
            None => None,
        };
        let receipt = self.with_mut(|s| s.import_file(&request, undo))?;
        json_text(&receipt)
    }
    pub fn export_fitnotes(&self, skeleton: Vec<u8>, now: String) -> Result<Vec<u8>, EngineError> {
        let snapshot = self.with(|s| Ok(s.engine.snapshot().clone()))?;
        fitnotes_export::build(&snapshot, &skeleton, &now).map_err(bridge_error)
    }
    pub fn parse_ai_plan(&self, raw: String) -> Result<String, EngineError> {
        let value = lift_domain::ai::parse(&raw).map_err(bridge_error)?;
        json_text(&value)
    }
    pub fn export_json(&self, username: String, now: String) -> Result<String, EngineError> {
        let snapshot = self.with(|s| Ok(s.engine.snapshot().clone()))?;
        serde_json::to_string_pretty(&lift_codec::export::user_json(&snapshot, &username, &now))
            .map_err(|e| bridge_error(e.to_string()))
    }
    pub fn prepare_upload(&self, now: String) -> Result<UploadSnapshot, EngineError> {
        let (capture, etag, device_id) = self.with(|s| {
            Ok((
                s.capture(),
                s.sync_state["etag"].as_str().map(str::to_string),
                s.installation_device_id.clone(),
            ))
        })?;
        Ok(UploadSnapshot {
            bytes: capture.encode(&now)?,
            generation: capture.generation,
            revision: capture.revision,
            etag,
            device_id,
        })
    }
    pub fn snapshot_bytes(&self, now: String) -> Result<Vec<u8>, EngineError> {
        let capture = self.with(|s| Ok(s.capture()))?;
        Ok(capture.encode(&now)?)
    }
    pub fn replace_snapshot(
        &self,
        bytes: Vec<u8>,
        generation: u64,
        revision: u64,
        remote_etag: Option<String>,
        now: String,
    ) -> Result<String, EngineError> {
        let start =
            match self.with(|s| s.begin_replace(&bytes, generation, revision, remote_etag))? {
                Ok(receipt) => return json_text(&receipt),
                Err(start) => start,
            };
        let ready = start.decode(&bytes, &now)?;
        let receipt = self.with_mut(|s| s.finish_replace(ready, &now))?;
        json_text(&receipt)
    }
    pub fn save_restore_point(&self, now: String) -> Result<(), EngineError> {
        if lift_domain::prs::timestamp_checked(&now).is_none() {
            return Err(bridge_error("Invalid restore point time".into()));
        }
        let capture = self.with(|s| Ok(s.capture()))?;
        let bytes = capture.encode(&now)?;
        let meta = capture.metadata(&now);
        self.with_mut(|s| s.write_restore_point(&bytes, meta, &now))
    }
    pub fn restore_points(&self) -> Result<String, EngineError> {
        Ok(self.with(|s| s.restore_points())?.to_string())
    }
    pub fn backup_bytes(&self, slot: String) -> Result<Option<Vec<u8>>, EngineError> {
        self.with(|s| s.backup_bytes(&slot))
    }
    pub fn acknowledge_push(
        &self,
        generation: u64,
        revision: u64,
        expected_etag: Option<String>,
        etag: String,
        now: String,
    ) -> Result<(), EngineError> {
        self.with_mut(|s| {
            s.acknowledge_push(generation, revision, expected_etag.as_deref(), &etag, &now)
        })
    }
    pub fn sync_state(&self) -> Result<String, EngineError> {
        self.with(|s| Ok(s.sync_state.to_string()))
    }
    /// Always succeeds and leaves the session closed.
    pub fn shutdown(&self) -> Result<(), EngineError> {
        self.guard().take();
        Ok(())
    }
    pub fn query(&self, query_json: String) -> Result<String, EngineError> {
        let query = serde_json::from_str(&query_json).map_err(|e| bridge_error(e.to_string()))?;
        let g = self.guard();
        let store = g.as_ref().ok_or_else(closed)?;
        let value = store.engine.try_query(query).map_err(query_error)?;
        json_text(&value)
    }
}

#[cfg(test)]
mod engine_tests {
    use super::*;
    fn open(dir: &std::path::Path) -> std::sync::Arc<NativeEngine> {
        NativeEngine::open(
            dir.join("engine.sqlite").to_str().unwrap().into(),
            "d".into(),
            "2026-01-01T00:00:00Z".into(),
            r#"{"etag":null}"#.into(),
        )
        .unwrap()
    }
    const NOTE: &str = r#"{"op":"set_day_note","date":"2026-01-01","text":"kept"}"#;
    #[test]
    fn a_panic_under_the_lock_reloads_the_store_instead_of_closing_it() {
        let dir = tempfile::tempdir().unwrap();
        let engine = open(dir.path());
        engine
            .execute("a".into(), 1, NOTE.into(), "now".into(), "today".into())
            .unwrap();
        let e = engine.clone();
        let _ = std::thread::spawn(move || {
            let _g = e.store.lock().unwrap();
            panic!("injected");
        })
        .join();
        assert!(engine.store.is_poisoned());
        let note = engine
            .query(r#"{"kind":"day_note","date":"2026-01-01"}"#.into())
            .unwrap();
        assert!(note.contains("kept"));
        engine.shutdown().unwrap();
        assert!(matches!(
            engine.query(r#"{"kind":"counts"}"#.into()),
            Err(EngineError::Closed { .. })
        ));
        // Shutdown always succeeds, even twice.
        engine.shutdown().unwrap();
    }
    #[test]
    fn errors_carry_their_kind_across_the_bridge() {
        let dir = tempfile::tempdir().unwrap();
        let engine = open(dir.path());
        assert!(matches!(
            engine.execute("a".into(), 7, NOTE.into(), "now".into(), "today".into()),
            Err(EngineError::Stale { .. })
        ));
        assert!(matches!(
            engine.replace_snapshot(vec![1, 2], 1, 99, None, "now".into()),
            Err(EngineError::Stale { .. })
        ));
        assert!(matches!(
            engine.execute("b".into(), 1, "{".into(), "now".into(), "today".into()),
            Err(EngineError::Failed { .. })
        ));
        let mut future =
            serde_json::to_value(lift_domain::model::Snapshot::empty("d".into(), "n".into()))
                .unwrap();
        future["schema_version"] = serde_json::json!(99);
        let bytes = {
            use std::io::Write;
            let mut g = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
            g.write_all(future.to_string().as_bytes()).unwrap();
            g.finish().unwrap()
        };
        assert!(matches!(
            engine.replace_snapshot(bytes.clone(), 1, 0, None, "now".into()),
            Err(EngineError::TooNew { .. })
        ));
        let other = tempfile::tempdir().unwrap();
        std::fs::write(other.path().join("snapshot.bin"), &bytes).unwrap();
        let err = NativeEngine::open(
            other.path().join("engine.sqlite").to_str().unwrap().into(),
            "d".into(),
            "now".into(),
            "{}".into(),
        )
        .err()
        .unwrap();
        assert!(matches!(err, EngineError::TooNew { .. }));
        assert!(!other.path().join("engine.sqlite").exists());
    }
    #[test]
    fn uploads_and_restore_points_are_encoded_from_a_consistent_capture() {
        let dir = tempfile::tempdir().unwrap();
        let engine = open(dir.path());
        engine
            .execute("a".into(), 1, NOTE.into(), "now".into(), "today".into())
            .unwrap();
        let upload = engine
            .prepare_upload("2026-01-01T00:00:00Z".into())
            .unwrap();
        assert_eq!(upload.revision, 1);
        let (s, _) = lift_codec::decode_snapshot(&upload.bytes, 1 << 20).unwrap();
        assert_eq!(s.day_notes[0].text, "kept");
        engine
            .save_restore_point("2026-01-01T00:00:00Z".into())
            .unwrap();
        assert!(engine.restore_points().unwrap().contains("\"current\""));
        assert!(engine.backup_bytes("current".into()).unwrap().is_some());
    }
}
