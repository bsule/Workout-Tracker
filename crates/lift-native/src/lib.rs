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
    let snapshot: lift_domain::model::Snapshot =
        serde_json::from_str(&snapshot_json).map_err(|e| bridge_error(e.to_string()))?;
    lift_domain::model::validate(&snapshot).map_err(bridge_error)?;
    fitnotes_export::build(&snapshot, &skeleton, &now).map_err(bridge_error)
}

#[uniffi::export]
pub fn export_legacy_json(
    snapshot_json: String,
    username: String,
    now: String,
) -> Result<String, EngineError> {
    let snapshot: lift_domain::model::Snapshot =
        serde_json::from_str(&snapshot_json).map_err(|e| bridge_error(e.to_string()))?;
    lift_domain::model::validate(&snapshot).map_err(bridge_error)?;
    serde_json::to_string_pretty(&lift_codec::export::user_json(&snapshot, &username, &now))
        .map_err(|e| bridge_error(e.to_string()))
}

mod fitnotes_export;
mod migration;
mod storage;

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

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum EngineError {
    #[error("{details}")]
    Failed { details: String },
}
fn bridge_error(message: String) -> EngineError {
    EngineError::Failed { details: message }
}

/// The Expo wrapper schedules calls onto its serial worker queue. The mutex
/// prevents concurrent host calls from observing prepared, uncommitted state.
#[derive(uniffi::Object)]
pub struct NativeEngine {
    store: std::sync::Mutex<Option<storage::Store>>,
}
#[uniffi::export]
impl NativeEngine {
    #[uniffi::constructor]
    pub fn open(
        path: String,
        device_id: String,
        now: String,
    ) -> Result<std::sync::Arc<Self>, EngineError> {
        migration::migrate_if_needed(std::path::Path::new(&path), &device_id, &now)
            .map_err(bridge_error)?;
        let store = storage::Store::open(&path, device_id, now).map_err(bridge_error)?;
        Ok(std::sync::Arc::new(Self {
            store: std::sync::Mutex::new(Some(store)),
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
        let mut store = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated; reopen required".into()))?;
        let store = store
            .as_mut()
            .ok_or_else(|| bridge_error("Engine closed".into()))?;
        let receipt = store
            .execute(command_id, generation, command, now, today)
            .map_err(bridge_error)?;
        serde_json::to_string(&receipt).map_err(|e| bridge_error(e.to_string()))
    }
    pub fn import_file_json(&self, request_json: String) -> Result<String, EngineError> {
        let request =
            serde_json::from_str(&request_json).map_err(|e| bridge_error(e.to_string()))?;
        self.import_file(request)
    }
    pub fn import_file(&self, request: ImportRequest) -> Result<String, EngineError> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        let receipt = guard
            .as_mut()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .import_file(&request)
            .map_err(bridge_error)?;
        serde_json::to_string(&receipt).map_err(|e| bridge_error(e.to_string()))
    }
    pub fn export_fitnotes(&self, skeleton: Vec<u8>, now: String) -> Result<Vec<u8>, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        let store = guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?;
        fitnotes_export::build(store.engine.snapshot(), &skeleton, &now).map_err(bridge_error)
    }
    pub fn parse_ai_plan(&self, raw: String) -> Result<String, EngineError> {
        let value = lift_domain::ai::parse(&raw).map_err(bridge_error)?;
        serde_json::to_string(&value).map_err(|e| bridge_error(e.to_string()))
    }
    pub fn export_json(&self, username: String, now: String) -> Result<String, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        let store = guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?;
        serde_json::to_string_pretty(&lift_codec::export::user_json(
            store.engine.snapshot(),
            &username,
            &now,
        ))
        .map_err(|e| bridge_error(e.to_string()))
    }
    pub fn prepare_upload(&self, now: String) -> Result<UploadSnapshot, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        let store = guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?;
        Ok(UploadSnapshot {
            bytes: store.snapshot_bytes(&now).map_err(bridge_error)?,
            generation: store.engine.generation,
            revision: store.engine.revision,
            etag: store.sync_state["etag"].as_str().map(str::to_string),
            device_id: store.installation_device_id.clone(),
        })
    }
    pub fn snapshot_bytes(&self, now: String) -> Result<Vec<u8>, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .snapshot_bytes(&now)
            .map_err(bridge_error)
    }
    pub fn replace_snapshot(
        &self,
        bytes: Vec<u8>,
        generation: u64,
        revision: u64,
        remote_etag: Option<String>,
        now: String,
    ) -> Result<String, EngineError> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        let receipt = guard
            .as_mut()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .replace_snapshot(&bytes, generation, revision, remote_etag, &now)
            .map_err(bridge_error)?;
        serde_json::to_string(&receipt).map_err(|e| bridge_error(e.to_string()))
    }
    pub fn save_restore_point(&self, now: String) -> Result<(), EngineError> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        guard
            .as_mut()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .save_restore_point(&now)
            .map_err(bridge_error)
    }
    pub fn restore_points(&self) -> Result<String, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        let value = guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .restore_points()
            .map_err(bridge_error)?;
        Ok(value.to_string())
    }
    pub fn backup_bytes(&self, slot: String) -> Result<Option<Vec<u8>>, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .backup_bytes(&slot)
            .map_err(bridge_error)
    }
    pub fn acknowledge_push(
        &self,
        generation: u64,
        revision: u64,
        expected_etag: Option<String>,
        etag: String,
        now: String,
    ) -> Result<(), EngineError> {
        let mut guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        guard
            .as_mut()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .acknowledge_push(generation, revision, expected_etag.as_deref(), &etag, &now)
            .map_err(bridge_error)
    }
    pub fn sync_state(&self) -> Result<String, EngineError> {
        let guard = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        Ok(guard
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?
            .sync_state
            .to_string())
    }
    pub fn shutdown(&self) -> Result<(), EngineError> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated".into()))?;
        store.take();
        Ok(())
    }
    pub fn query(&self, query_json: String) -> Result<String, EngineError> {
        let query = serde_json::from_str(&query_json).map_err(|e| bridge_error(e.to_string()))?;
        let store = self
            .store
            .lock()
            .map_err(|_| bridge_error("Engine invalidated; reopen required".into()))?;
        let store = store
            .as_ref()
            .ok_or_else(|| bridge_error("Engine closed".into()))?;
        serde_json::to_string(&store.engine.try_query(query).map_err(bridge_error)?)
            .map_err(|e| bridge_error(e.to_string()))
    }
}
