//! Portable prepare/persist/publish coordinator. A host must persist a prepared
//! change before publishing it. No filesystem or platform dependencies.
use lift_domain::{
    commands::{apply_command, Command, Context},
    model::Snapshot,
    queries::{Indexes, Query},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub command_id: String,
    pub payload: Value,
    pub generation: u64,
    pub revision: u64,
    pub result: Value,
}
pub struct Prepared {
    pub base_revision: u64,
    pub base_generation: u64,
    pub snapshot: Snapshot,
    pub next_id: u64,
    pub receipt: Receipt,
}
pub struct Engine {
    pub snapshot: Snapshot,
    pub revision: u64,
    pub generation: u64,
    pub next_id: u64,
    indexes: Indexes,
}
impl Engine {
    pub fn new(snapshot: Snapshot, revision: u64, generation: u64, next_id: u64) -> Self {
        let indexes = Indexes::build(&snapshot);
        Self {
            snapshot,
            revision,
            generation,
            next_id,
            indexes,
        }
    }
    pub fn prepare(
        &self,
        command_id: String,
        command: Command,
        now: String,
        today: String,
    ) -> Result<Prepared, String> {
        if command_id.is_empty() || command_id.len() > 256 {
            return Err("Invalid command ID".into());
        }
        let payload = serde_json::to_value(&command).map_err(|e| e.to_string())?;
        let mut snapshot = self.snapshot.clone();
        let mut ctx = Context {
            now,
            today,
            next_id: self.next_id,
        };
        let result = apply_command(&mut snapshot, command, &mut ctx)?;
        lift_domain::model::validate(&snapshot)?;
        Ok(Prepared {
            base_revision: self.revision,
            base_generation: self.generation,
            snapshot,
            next_id: ctx.next_id,
            receipt: Receipt {
                command_id,
                payload,
                generation: self.generation,
                revision: self.revision + 1,
                result,
            },
        })
    }
    pub fn prepare_import(
        &self,
        id: String,
        format: &str,
        input: &str,
        replace: bool,
        mut ctx: Context,
    ) -> Result<Prepared, String> {
        if id.is_empty() || id.len() > 256 {
            return Err("Invalid import ID".into());
        }
        let mut snapshot = self.snapshot.clone();
        let result = match format {
            "json" => lift_codec::user_import::import(&mut snapshot, input, replace, &mut ctx),
            "csv" => lift_codec::fitnotes::import(&mut snapshot, input, replace, &mut ctx),
            _ => return Err("Unsupported import format".into()),
        }
        .map_err(|e| e.to_string())?;
        let generation = if replace {
            self.generation
                .checked_add(1)
                .ok_or("Generation overflow")?
        } else {
            self.generation
        };
        Ok(Prepared {
            base_revision: self.revision,
            base_generation: self.generation,
            snapshot,
            next_id: ctx.next_id,
            receipt: Receipt {
                command_id: id,
                payload: import_identity(format, input, replace),
                generation,
                revision: self.revision.checked_add(1).ok_or("Revision overflow")?,
                result,
            },
        })
    }
    pub fn prepare_replacement(
        &self,
        id: String,
        snapshot: Snapshot,
        payload: Value,
    ) -> Result<Prepared, String> {
        lift_domain::model::validate(&snapshot)?;
        if id.is_empty() || id.len() > 256 {
            return Err("Invalid replacement ID".into());
        }
        let next_id = snapshot
            .exercises
            .iter()
            .map(|r| r.id)
            .chain(snapshot.workouts.iter().map(|r| r.id))
            .chain(snapshot.workout_exercises.iter().map(|r| r.id))
            .chain(snapshot.sets.iter().map(|r| r.id))
            .chain(snapshot.gyms.iter().map(|r| r.id))
            .max()
            .unwrap_or(0)
            + 1;
        let generation = self
            .generation
            .checked_add(1)
            .ok_or("Generation overflow")?;
        let revision = self.revision.checked_add(1).ok_or("Revision overflow")?;
        Ok(Prepared {
            base_revision: self.revision,
            base_generation: self.generation,
            snapshot,
            next_id,
            receipt: Receipt {
                command_id: id,
                payload,
                generation,
                revision,
                result: Value::Null,
            },
        })
    }
    pub fn publish(&mut self, prepared: Prepared) -> Result<Receipt, String> {
        if prepared.base_revision != self.revision || prepared.base_generation != self.generation {
            return Err("Stale prepared change".into());
        }
        self.generation = prepared.receipt.generation;
        self.snapshot = prepared.snapshot;
        self.revision = prepared.receipt.revision;
        self.next_id = prepared.next_id;
        self.indexes = Indexes::build(&self.snapshot);
        Ok(prepared.receipt)
    }
    pub fn query(&self, q: Query) -> Value {
        json!({"revision":self.revision,"generation":self.generation,"data":lift_domain::queries::query(&self.snapshot,&self.indexes,q)})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepared_change_is_invisible_until_published() {
        let mut engine = Engine::new(Snapshot::empty("device".into(), "now".into()), 0, 1, 1);
        let pending = engine
            .prepare(
                "c1".into(),
                Command::SetDayNote {
                    date: "2026-01-01".into(),
                    text: "note".into(),
                },
                "now".into(),
                "2026-01-01".into(),
            )
            .unwrap();
        assert!(engine.snapshot.day_notes.is_empty());
        assert_eq!(engine.revision, 0);
        engine.publish(pending).unwrap();
        assert_eq!(engine.snapshot.day_notes.len(), 1);
        assert_eq!(engine.revision, 1);
    }
}

/// Cross-platform storage protocol. Only changed rows cross into the browser
/// adapter; ordinary mutations never transfer the entire snapshot to React.
#[derive(Serialize, Deserialize, Debug)]
pub struct RowWrite {
    pub table: String,
    pub key: String,
    pub value: Option<Value>,
    pub ordinal: usize,
}
#[derive(Serialize, Deserialize, Debug)]
pub struct WriteSet {
    pub base_revision: u64,
    pub base_generation: u64,
    pub revision: u64,
    pub generation: u64,
    pub next_id: u64,
    pub header: Value,
    pub rows: Vec<RowWrite>,
    pub receipt: Receipt,
}
pub fn write_set(engine: &Engine, pending: &Prepared) -> Result<WriteSet, String> {
    fn diff<T: Serialize + PartialEq, K: std::hash::Hash + Eq + ToString>(
        table: &str,
        old: &[T],
        new: &[T],
        key_of: impl Fn(&T) -> K,
        rows: &mut Vec<RowWrite>,
    ) -> Result<(), String> {
        let mut keys = std::collections::HashSet::new();
        for (i, row) in new.iter().enumerate() {
            let key = key_of(row);
            if old.get(i) != Some(row) {
                rows.push(RowWrite {
                    table: table.into(),
                    key: key.to_string(),
                    value: Some(serde_json::to_value(row).map_err(|e| e.to_string())?),
                    ordinal: i,
                });
            }
            if !keys.insert(key) {
                return Err("Duplicate row key".into());
            }
        }
        for (i, row) in old.iter().enumerate() {
            let key = key_of(row);
            if !keys.contains(&key) {
                rows.push(RowWrite {
                    table: table.into(),
                    key: key.to_string(),
                    value: None,
                    ordinal: i,
                });
            }
        }
        Ok(())
    }
    let old = &engine.snapshot;
    let new = &pending.snapshot;
    let mut rows = vec![];
    diff(
        "exercises",
        &old.exercises,
        &new.exercises,
        |r| r.id,
        &mut rows,
    )?;
    diff(
        "workouts",
        &old.workouts,
        &new.workouts,
        |r| r.id,
        &mut rows,
    )?;
    diff(
        "workout_exercises",
        &old.workout_exercises,
        &new.workout_exercises,
        |r| r.id,
        &mut rows,
    )?;
    diff("sets", &old.sets, &new.sets, |r| r.id, &mut rows)?;
    diff("gyms", &old.gyms, &new.gyms, |r| r.id, &mut rows)?;
    diff(
        "day_notes",
        &old.day_notes,
        &new.day_notes,
        |r| r.date.clone(),
        &mut rows,
    )?;
    let header = json!({"schema_version":new.schema_version,"exported_at":new.exported_at,"device_id":new.device_id,"settings":new.settings});
    Ok(WriteSet {
        base_revision: pending.base_revision,
        base_generation: pending.base_generation,
        revision: pending.receipt.revision,
        generation: pending.receipt.generation,
        next_id: pending.next_id,
        header,
        rows,
        receipt: pending.receipt.clone(),
    })
}

pub mod sync;

pub fn import_identity(format: &str, input: &str, replace: bool) -> Value {
    use sha2::{Digest, Sha256};
    json!({"op":"import_file","format":format,"replace":replace,"sha256":format!("{:x}",Sha256::digest(input.as_bytes()))})
}
