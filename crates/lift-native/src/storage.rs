//! Transactional native record storage. Derived in-memory state is published
//! only after SQLite commits records, revision, allocator and receipt together.
use lift_domain::{commands::Command, model::Snapshot, queries::Query};
use lift_engine::{Engine, Prepared, Receipt};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

pub struct Store {
    db: Connection,
    pub engine: Engine,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
impl Store {
    pub fn open(path: &str, device_id: String, now: String) -> Result<Self, String> {
        let db = Connection::open(path).map_err(error)?;
        let version: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(error)?;
        if version > 1 {
            return Err("Unsupported native database version".into());
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(error)?;
        db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(kind,key)); CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (generation INTEGER NOT NULL, command_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(generation,command_id)); PRAGMA user_version=1; COMMIT;").map_err(error)?;
        let meta: Option<String> = db
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(error)?;
        let engine = if let Some(meta) = meta {
            let meta: Value = serde_json::from_str(&meta).map_err(error)?;
            let mut snap = meta["header"].clone();
            for name in [
                "exercises",
                "workouts",
                "workout_exercises",
                "sets",
                "gyms",
                "day_notes",
            ] {
                let mut stmt = db
                    .prepare("SELECT value FROM records WHERE kind=? ORDER BY ordinal")
                    .map_err(error)?;
                let values = stmt
                    .query_map([name], |r| r.get::<_, String>(0))
                    .map_err(error)?;
                let mut rows = vec![];
                for v in values {
                    rows.push(serde_json::from_str::<Value>(&v.map_err(error)?).map_err(error)?);
                }
                snap[name] = Value::Array(rows);
            }
            let snapshot: Snapshot = serde_json::from_value(snap).map_err(error)?;
            lift_domain::model::validate(&snapshot)?;
            if snapshot.schema_version > lift_domain::model::SCHEMA_VERSION {
                return Err("Unsupported export schema".into());
            }
            Engine::new(
                snapshot,
                meta["revision"].as_u64().ok_or("Invalid revision")?,
                meta["generation"].as_u64().ok_or("Invalid generation")?,
                meta["next_id"].as_u64().ok_or("Invalid allocator")?,
            )
        } else {
            Engine::new(Snapshot::empty(device_id, now), 0, 1, 1)
        };
        Ok(Self { db, engine })
    }
    pub fn receipt(&self, id: &str) -> Result<Option<Receipt>, String> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM receipts WHERE generation=? AND command_id=?",
                rusqlite::params![self.engine.generation, id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        value
            .map(|s| serde_json::from_str(&s).map_err(error))
            .transpose()
    }
    pub fn execute(
        &mut self,
        id: String,
        generation: u64,
        command: Command,
        now: String,
        today: String,
    ) -> Result<Receipt, String> {
        if generation != self.engine.generation {
            return Err("Stale dataset generation".into());
        }
        if let Some(receipt) = self.receipt(&id)? {
            if receipt.payload != serde_json::to_value(&command).map_err(error)? {
                return Err("Command ID reused with different payload".into());
            }
            return Ok(receipt);
        }
        let pending = self.engine.prepare(id, command, now, today)?;
        self.commit(pending)
    }
    fn commit(&mut self, pending: Prepared) -> Result<Receipt, String> {
        let writes = lift_engine::write_set(&self.engine, &pending)?;
        let tx = self.db.transaction().map_err(error)?;
        let stored: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(error)?;
        let current = stored
            .map(|s| serde_json::from_str::<Value>(&s).map_err(error))
            .transpose()?
            .map(|v| v["revision"].as_u64().unwrap_or(u64::MAX))
            .unwrap_or(0);
        if current != pending.base_revision {
            return Err("Concurrent writer changed revision; reopen required".into());
        }
        for row in &writes.rows {
            if let Some(value) = &row.value {
                tx.execute("INSERT INTO records(kind,key,value,ordinal) VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,ordinal=excluded.ordinal",rusqlite::params![row.table,row.key,value.to_string(),row.ordinal]).map_err(error)?;
            } else {
                tx.execute(
                    "DELETE FROM records WHERE kind=? AND key=?",
                    rusqlite::params![row.table, row.key],
                )
                .map_err(error)?;
            }
        }
        let meta = json!({"header":writes.header,"revision":writes.revision,"generation":writes.generation,"next_id":writes.next_id});
        tx.execute("INSERT INTO meta(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[meta.to_string()]).map_err(error)?;
        tx.execute(
            "INSERT INTO receipts(generation,command_id,value) VALUES(?,?,?)",
            rusqlite::params![
                self.engine.generation,
                pending.receipt.command_id,
                serde_json::to_string(&pending.receipt).map_err(error)?
            ],
        )
        .map_err(error)?;
        tx.commit().map_err(error)?;
        self.engine.publish(pending)
    }
    pub(crate) fn checkpoint(&self) -> Result<(), String> {
        let (busy, log, remaining): (i64, i64, i64) = self
            .db
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(error)?;
        if busy != 0 || log != remaining {
            return Err("Database checkpoint incomplete".into());
        }
        Ok(())
    }
    pub(crate) fn install_snapshot(&mut self, snapshot: Snapshot) -> Result<(), String> {
        if self.engine.revision != 0 {
            return Err("Store already initialized".into());
        }
        lift_domain::model::validate(&snapshot)?;
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
        let receipt = Receipt {
            command_id: "__legacy_migration_v1".into(),
            payload: json!({"op":"legacy_migration"}),
            generation: 1,
            revision: 1,
            result: Value::Null,
        };
        self.commit(Prepared {
            base_revision: 0,
            snapshot,
            next_id,
            receipt,
        })?;
        Ok(())
    }
    pub fn query(&self, q: Query) -> Value {
        self.engine.query(q)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_receipt_and_payload_guard() {
        let path = std::env::temp_dir().join(format!(
            "lift-engine-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let command = Command::SetDayNote {
            date: "2026-01-01".into(),
            text: "keep me".into(),
        };
        let mut store = Store::open(path.to_str().unwrap(), "device".into(), "now".into()).unwrap();
        let receipt = store
            .execute(
                "one".into(),
                1,
                command.clone(),
                "now".into(),
                "2026-01-01".into(),
            )
            .unwrap();
        assert_eq!(receipt.revision, 1);
        drop(store);
        let mut store = Store::open(path.to_str().unwrap(), "device".into(), "now".into()).unwrap();
        assert_eq!(store.engine.snapshot.day_notes[0].text, "keep me");
        assert_eq!(
            store
                .execute("one".into(), 1, command, "now".into(), "2026-01-01".into())
                .unwrap()
                .revision,
            1
        );
        assert!(store
            .execute(
                "one".into(),
                1,
                Command::DeleteGym { id: 1 },
                "now".into(),
                "2026-01-01".into()
            )
            .is_err());
        assert_eq!(store.engine.revision, 1);
        drop(store);
        std::fs::remove_file(path).unwrap();
    }
}
