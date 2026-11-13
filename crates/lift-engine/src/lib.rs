//! Portable prepare/persist/publish coordinator. A host must persist a prepared
//! change before publishing it. No filesystem or platform dependencies.
use lift_domain::{
    commands::{apply_command_indexed, next_available_id, Command, Context},
    diff::{diff, validate_changes, Changes},
    lookup::{Lookup, Verified},
    model::{DayNoteRow, ExerciseRow, GymRow, SetRow, Snapshot, WorkoutExerciseRow, WorkoutRow},
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
    /// Rows that differ from the committed snapshot the change was prepared
    /// against. Computed by `Engine::finish`.
    pub changes: Changes,
    /// Exercises whose PR flags this change verified; None when the change
    /// replaced data, so nothing stays verified.
    pub verified: Option<Verified>,
}
pub struct Engine {
    snapshot: Snapshot,
    pub revision: u64,
    pub generation: u64,
    pub next_id: u64,
    indexes: Indexes,
    verified: Verified,
}
impl Engine {
    pub fn snapshot(&self) -> &Snapshot {
        &self.snapshot
    }
    /// Exercises whose stored PR flags are derived, for hosts that persist it.
    pub fn verified(&self) -> &Verified {
        &self.verified
    }
    /// Restores verification a host persisted with the committed data.
    pub fn restore_verified(&mut self, verified: Verified) {
        self.verified = verified;
    }
    /// The verification state after `prepared` publishes.
    pub fn verified_after(&self, prepared: &Prepared) -> Verified {
        match &prepared.verified {
            Some(v) => {
                let mut next = self.verified.clone();
                next.absorb(v);
                next
            }
            None => Verified::default(),
        }
    }
    pub fn new(
        snapshot: Snapshot,
        revision: u64,
        generation: u64,
        next_id: u64,
    ) -> Result<Self, String> {
        lift_domain::model::validate(&snapshot)?;
        let next_id = next_id.max(next_available_id(&snapshot));
        let indexes = Indexes::build(&snapshot);
        Ok(Self {
            snapshot,
            revision,
            generation,
            next_id,
            indexes,
            verified: Verified::default(),
        })
    }
    /// Diffs a prepared snapshot against the committed one. `validated`
    /// skips the row checks for a snapshot already validated in full.
    fn finish(
        &self,
        snapshot: Snapshot,
        next_id: u64,
        receipt: Receipt,
        validated: bool,
    ) -> Result<Prepared, String> {
        let changes = diff(&self.snapshot, &snapshot)?;
        if !validated {
            validate_changes(&self.snapshot, &self.indexes, &snapshot, &changes)?;
        }
        Ok(Prepared {
            base_revision: self.revision,
            base_generation: self.generation,
            snapshot,
            next_id,
            receipt,
            changes,
            verified: None,
        })
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
        let look = Lookup::with_verified(&self.indexes, &self.snapshot, &self.verified);
        let result = apply_command_indexed(&mut snapshot, command, &mut ctx, &look)?;
        let receipt = Receipt {
            command_id,
            payload,
            generation: self.generation,
            revision: self.revision + 1,
            result,
        };
        let mut prepared = self.finish(snapshot, ctx.next_id, receipt, false)?;
        prepared.verified = Some(look.take_verified());
        Ok(prepared)
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
        let receipt = Receipt {
            command_id: id,
            payload: import_identity(format, input, replace),
            generation,
            revision: self.revision.checked_add(1).ok_or("Revision overflow")?,
            result,
        };
        // The importers validate the whole result.
        self.finish(snapshot, ctx.next_id, receipt, true)
    }
    pub fn prepare_replacement(
        &self,
        id: String,
        mut snapshot: Snapshot,
        payload: Value,
    ) -> Result<Prepared, String> {
        lift_domain::model::repair(&mut snapshot);
        lift_domain::model::validate(&snapshot)?;
        if id.is_empty() || id.len() > 256 {
            return Err("Invalid replacement ID".into());
        }
        let next_id = next_available_id(&snapshot);
        let generation = self
            .generation
            .checked_add(1)
            .ok_or("Generation overflow")?;
        let revision = self.revision.checked_add(1).ok_or("Revision overflow")?;
        let receipt = Receipt {
            command_id: id,
            payload,
            generation,
            revision,
            result: Value::Null,
        };
        self.finish(snapshot, next_id, receipt, true)
    }
    /// The first dataset of a new store, in the same generation.
    pub fn prepare_initial(
        &self,
        id: String,
        mut snapshot: Snapshot,
        payload: Value,
    ) -> Result<Prepared, String> {
        lift_domain::model::repair(&mut snapshot);
        lift_domain::model::validate(&snapshot)?;
        let next_id = self.next_id.max(next_available_id(&snapshot));
        let receipt = Receipt {
            command_id: id,
            payload,
            generation: self.generation,
            revision: self.revision.checked_add(1).ok_or("Revision overflow")?,
            result: Value::Null,
        };
        self.finish(snapshot, next_id, receipt, true)
    }
    /// A repaired copy of the committed data, adopted without a revision:
    /// the host persists the dropped rows and publishes it on open.
    pub fn prepare_repair(&self, snapshot: Snapshot) -> Result<Prepared, String> {
        lift_domain::model::validate(&snapshot)?;
        let receipt = Receipt {
            command_id: "__repair".into(),
            payload: Value::Null,
            generation: self.generation,
            revision: self.revision,
            result: Value::Null,
        };
        let next_id = self.next_id.max(next_available_id(&snapshot));
        self.finish(snapshot, next_id, receipt, true)
    }
    pub fn publish(&mut self, prepared: Prepared) -> Result<Receipt, String> {
        if prepared.base_revision != self.revision || prepared.base_generation != self.generation {
            return Err("Stale prepared change".into());
        }
        self.indexes
            .apply(&self.snapshot, &prepared.snapshot, &prepared.changes);
        self.verified = self.verified_after(&prepared);
        self.generation = prepared.receipt.generation;
        self.snapshot = prepared.snapshot;
        self.revision = prepared.receipt.revision;
        self.next_id = prepared.next_id;
        Ok(prepared.receipt)
    }
    pub fn try_query(&self, q: Query) -> Result<Value, String> {
        if let Query::HistoryPage {
            exercise_id,
            cursor,
            limit,
        } = q
        {
            #[derive(Serialize, Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Cursor {
                generation: u64,
                revision: u64,
                exercise_id: u64,
                offset: usize,
            }
            let offset = if let Some(cursor) = cursor {
                if cursor.len() > 512 {
                    return Err("Invalid history cursor".into());
                }
                let cursor: Cursor =
                    serde_json::from_str(&cursor).map_err(|_| "Invalid history cursor")?;
                if cursor.generation != self.generation
                    || cursor.revision != self.revision
                    || cursor.exercise_id != exercise_id
                {
                    return Err("History changed; restart pagination".into());
                }
                cursor.offset
            } else {
                0
            };
            let (total, items) =
                self.indexes
                    .history_page(&self.snapshot, exercise_id, offset, limit.clamp(1, 100));
            let end = offset.saturating_add(items.len());
            let next_cursor = if end < total {
                Some(
                    serde_json::to_string(&Cursor {
                        generation: self.generation,
                        revision: self.revision,
                        exercise_id,
                        offset: end,
                    })
                    .map_err(|e| e.to_string())?,
                )
            } else {
                None
            };
            return Ok(
                json!({"revision":self.revision,"generation":self.generation,"data":{"total":total,"items":items,"next_cursor":next_cursor}}),
            );
        }
        Ok(self.query(q))
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
        let mut engine =
            Engine::new(Snapshot::empty("device".into(), "now".into()), 0, 1, 1).unwrap();
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
/// `ordinal` orders rows within a table on reload; it grows along the table
/// and is kept by surviving rows, so a delete rewrites no other row.
#[derive(Serialize, Deserialize, Debug)]
pub struct RowWrite {
    pub table: String,
    pub key: String,
    pub value: Option<Value>,
    pub ordinal: i64,
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
/// One durable row change: `value` is None for a delete.
pub struct RowChange<'a> {
    pub table: &'static str,
    pub key: String,
    pub value: Option<RowRef<'a>>,
    pub ordinal: i64,
}
/// A typed reference to a changed row, so each host can store it in its own
/// format.
#[derive(Clone, Copy)]
pub enum RowRef<'a> {
    Exercise(&'a ExerciseRow),
    Workout(&'a WorkoutRow),
    WorkoutExercise(&'a WorkoutExerciseRow),
    Set(&'a SetRow),
    Gym(&'a GymRow),
    DayNote(&'a DayNoteRow),
}
impl RowRef<'_> {
    pub fn to_value(&self) -> serde_json::Result<Value> {
        match self {
            Self::Exercise(r) => serde_json::to_value(r),
            Self::Workout(r) => serde_json::to_value(r),
            Self::WorkoutExercise(r) => serde_json::to_value(r),
            Self::Set(r) => serde_json::to_value(r),
            Self::Gym(r) => serde_json::to_value(r),
            Self::DayNote(r) => serde_json::to_value(r),
        }
    }
}
/// Every durable row change in a prepared commit.
pub fn row_changes(pending: &Prepared) -> Vec<RowChange<'_>> {
    fn table<'a, T>(
        out: &mut Vec<RowChange<'a>>,
        name: &'static str,
        rows: &'a lift_domain::table::Table<T>,
        d: &lift_domain::diff::TableDiff,
        key_of: impl Fn(&T) -> String,
        wrap: fn(&'a T) -> RowRef<'a>,
    ) {
        for &p in &d.upserts {
            let row = &rows[p];
            out.push(RowChange {
                table: name,
                key: key_of(row),
                value: Some(wrap(row)),
                ordinal: rows.ordinal(p).unwrap_or(0),
            });
        }
        for key in &d.deletes {
            out.push(RowChange {
                table: name,
                key: key.clone(),
                value: None,
                ordinal: 0,
            });
        }
    }
    let s = &pending.snapshot;
    let c = &pending.changes;
    let mut out = vec![];
    table(
        &mut out,
        "exercises",
        &s.exercises,
        &c.exercises,
        |r| r.id.to_string(),
        RowRef::Exercise,
    );
    table(
        &mut out,
        "workouts",
        &s.workouts,
        &c.workouts,
        |r| r.id.to_string(),
        RowRef::Workout,
    );
    table(
        &mut out,
        "workout_exercises",
        &s.workout_exercises,
        &c.workout_exercises,
        |r| r.id.to_string(),
        RowRef::WorkoutExercise,
    );
    table(
        &mut out,
        "sets",
        &s.sets,
        &c.sets,
        |r| r.id.to_string(),
        RowRef::Set,
    );
    table(
        &mut out,
        "gyms",
        &s.gyms,
        &c.gyms,
        |r| r.id.to_string(),
        RowRef::Gym,
    );
    table(
        &mut out,
        "day_notes",
        &s.day_notes,
        &c.day_notes,
        |r| r.date.clone(),
        RowRef::DayNote,
    );
    out
}
pub fn header(s: &Snapshot) -> Value {
    json!({"schema_version":s.schema_version,"exported_at":s.exported_at,"device_id":s.device_id,"settings":s.settings})
}
pub fn write_set(_engine: &Engine, pending: &Prepared) -> Result<WriteSet, String> {
    let mut rows = vec![];
    for change in row_changes(pending) {
        rows.push(RowWrite {
            table: change.table.into(),
            key: change.key,
            value: change
                .value
                .map(|v| v.to_value())
                .transpose()
                .map_err(|e| e.to_string())?,
            ordinal: change.ordinal,
        });
    }
    Ok(WriteSet {
        base_revision: pending.base_revision,
        base_generation: pending.base_generation,
        revision: pending.receipt.revision,
        generation: pending.receipt.generation,
        next_id: pending.next_id,
        header: header(&pending.snapshot),
        rows,
        receipt: pending.receipt.clone(),
    })
}

pub mod sync;

pub fn import_identity(format: &str, input: &str, replace: bool) -> Value {
    use sha2::{Digest, Sha256};
    json!({"op":"import_file","format":format,"replace":replace,"sha256":format!("{:x}",Sha256::digest(input.as_bytes()))})
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
