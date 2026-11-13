//! Browser worker binding. Persistence remains asynchronous in the host;
//! prepared writes stay invisible until the host confirms durable commit.
use lift_domain::{model::Snapshot, table::Table};
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
    /// `ordinals_json`, optional, gives each table's stored ordinals in row
    /// order (`{"sets":[0,1,5],...}`); without it rows are numbered from 0.
    /// Later writes continue from these, so pass what storage holds.
    #[wasm_bindgen(constructor)]
    pub fn new(
        snapshot_json: &str,
        revision: u32,
        generation: u32,
        next_id: f64,
        ordinals_json: Option<String>,
    ) -> Result<BrowserEngine, JsValue> {
        if !next_id.is_finite()
            || next_id < 1.0
            || next_id.fract() != 0.0
            || next_id > 9_007_199_254_740_991.0
        {
            return Err(error("Invalid allocator"));
        }
        let mut snapshot: Snapshot = serde_json::from_str(snapshot_json).map_err(error)?;
        if let Some(ordinals) = ordinals_json {
            let ordinals: std::collections::HashMap<String, Vec<i64>> =
                serde_json::from_str(&ordinals).map_err(error)?;
            fn renumber<T: Clone>(
                t: &mut Table<T>,
                ords: Option<&Vec<i64>>,
            ) -> Result<(), JsValue> {
                let Some(ords) = ords else { return Ok(()) };
                if ords.len() != t.len() || ords.windows(2).any(|w| w[0] >= w[1]) {
                    return Err(error("Invalid stored ordinals"));
                }
                *t = Table::from_ordered(ords.iter().copied().zip(t.iter().cloned()));
                Ok(())
            }
            renumber(&mut snapshot.exercises, ordinals.get("exercises"))?;
            renumber(&mut snapshot.workouts, ordinals.get("workouts"))?;
            renumber(
                &mut snapshot.workout_exercises,
                ordinals.get("workout_exercises"),
            )?;
            renumber(&mut snapshot.sets, ordinals.get("sets"))?;
            renumber(&mut snapshot.gyms, ordinals.get("gyms"))?;
            renumber(&mut snapshot.day_notes, ordinals.get("day_notes"))?;
        }
        Ok(Self {
            engine: Engine::new(snapshot, revision.into(), generation.into(), next_id as u64)
                .map_err(error)?,
            pending: None,
        })
    }
    pub fn query(&self, query_json: &str) -> Result<String, JsValue> {
        let query = serde_json::from_str(query_json).map_err(error)?;
        serde_json::to_string(&self.engine.try_query(query).map_err(error)?).map_err(error)
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
fn decode(bytes: &[u8]) -> Result<(Snapshot, bool), JsValue> {
    let (mut snapshot, migrated) =
        lift_codec::decode_snapshot(bytes, 128 * 1024 * 1024).map_err(error)?;
    if migrated {
        // Schema bumps v8 and v9 exist to make every load recompute PRs.
        lift_domain::prs::recompute(&mut snapshot, None);
    }
    lift_domain::model::repair(&mut snapshot);
    Ok((snapshot, migrated))
}
/// Snapshot JSON, migrated and with PR flags recomputed when it was older.
#[wasm_bindgen]
pub fn decode_snapshot(bytes: &[u8]) -> Result<String, JsValue> {
    serde_json::to_string(&decode(bytes)?.0).map_err(error)
}
/// `{"snapshot": ..., "migrated": bool}`.
#[wasm_bindgen]
pub fn decode_snapshot_info(bytes: &[u8]) -> Result<String, JsValue> {
    let (snapshot, migrated) = decode(bytes)?;
    serde_json::to_string(&serde_json::json!({"snapshot":snapshot,"migrated":migrated}))
        .map_err(error)
}

#[cfg(test)]
mod tests {
    #[test]
    fn older_snapshots_report_migration_and_get_fresh_pr_flags() {
        use std::io::Write;
        let f: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/engine-parity/prs.json")).unwrap();
        let mut input = f[0]["input"].clone();
        input["schema_version"] = serde_json::json!(8);
        let mut g = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
        g.write_all(input.to_string().as_bytes()).unwrap();
        let out: serde_json::Value =
            serde_json::from_str(&super::decode_snapshot_info(&g.finish().unwrap()).unwrap())
                .unwrap();
        assert_eq!(out["migrated"], true);
        let expected = &f[0]["expected"]["sets"];
        for (a, b) in out["snapshot"]["sets"]
            .as_array()
            .unwrap()
            .iter()
            .zip(expected.as_array().unwrap())
        {
            for k in ["is_pr", "was_pr", "is_position_pr", "was_position_pr"] {
                assert_eq!(a[k], b[k], "{k}");
            }
        }
    }
}
