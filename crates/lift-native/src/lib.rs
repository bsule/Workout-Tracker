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

mod migration;
mod storage;

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum EngineError {
    #[error("{message}")]
    Failed { message: String },
}
fn bridge_error(message: String) -> EngineError {
    EngineError::Failed { message }
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
        serde_json::to_string(&store.query(query)).map_err(|e| bridge_error(e.to_string()))
    }
}
