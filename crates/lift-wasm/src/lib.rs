//! Browser worker binding. Persistence remains asynchronous in the host;
//! prepared writes stay invisible until the host confirms durable commit.
use lift_engine::{Engine, Prepared};
use wasm_bindgen::prelude::*;
fn error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
#[wasm_bindgen]
pub struct BrowserEngine {
    engine: Engine,
    pending: Option<Prepared>,
}
#[wasm_bindgen]
impl BrowserEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        snapshot_json: &str,
        revision: u32,
        generation: u32,
        next_id: f64,
    ) -> Result<BrowserEngine, JsValue> {
        if !next_id.is_finite()
            || next_id < 1.0
            || next_id.fract() != 0.0
            || next_id > 9_007_199_254_740_991.0
        {
            return Err(error("Invalid allocator"));
        }
        let snapshot = serde_json::from_str(snapshot_json).map_err(error)?;
        lift_domain::model::validate(&snapshot).map_err(error)?;
        Ok(Self {
            engine: Engine::new(snapshot, revision.into(), generation.into(), next_id as u64),
            pending: None,
        })
    }
    pub fn query(&self, query_json: &str) -> Result<String, JsValue> {
        let query = serde_json::from_str(query_json).map_err(error)?;
        serde_json::to_string(&self.engine.query(query)).map_err(error)
    }
    pub fn prepare(
        &mut self,
        command_id: String,
        command_json: &str,
        now: String,
        today: String,
    ) -> Result<String, JsValue> {
        if self.pending.is_some() {
            return Err(error("A durable commit is already pending"));
        }
        let command = serde_json::from_str(command_json).map_err(error)?;
        let pending = self
            .engine
            .prepare(command_id, command, now, today)
            .map_err(error)?;
        let writes = lift_engine::write_set(&self.engine, &pending).map_err(error)?;
        let result = serde_json::to_string(&writes).map_err(error)?;
        self.pending = Some(pending);
        Ok(result)
    }
    pub fn publish(&mut self, command_id: &str) -> Result<String, JsValue> {
        if self
            .pending
            .as_ref()
            .is_none_or(|p| p.receipt.command_id != command_id)
        {
            return Err(error("No matching prepared commit"));
        }
        let receipt = self
            .engine
            .publish(self.pending.take().unwrap())
            .map_err(error)?;
        serde_json::to_string(&receipt).map_err(error)
    }
    pub fn discard(&mut self, command_id: &str) -> Result<(), JsValue> {
        if self
            .pending
            .as_ref()
            .is_none_or(|p| p.receipt.command_id != command_id)
        {
            return Err(error("No matching prepared commit"));
        }
        self.pending = None;
        Ok(())
    }
}
#[wasm_bindgen]
pub fn decode_snapshot(bytes: &[u8]) -> Result<String, JsValue> {
    let (snapshot, _) = lift_codec::decode(bytes, 128 * 1024 * 1024).map_err(error)?;
    serde_json::to_string(&snapshot).map_err(error)
}
