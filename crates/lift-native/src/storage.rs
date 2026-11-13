//! Transactional native record storage. Derived in-memory state is published
//! only after SQLite commits records, revision, allocator and receipt together.
use lift_domain::{commands::Command, model::Snapshot, queries::Query};
use lift_engine::{Engine, Prepared, Receipt};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

pub struct Store {
    db: Connection,
    pub engine: Engine,
    pub sync_state: Value,
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
        if version > 2 {
            return Err("Unsupported native database version".into());
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(error)?;
        db.execute_batch("BEGIN; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(kind,key)); CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (generation INTEGER NOT NULL, command_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(generation,command_id)); CREATE TABLE IF NOT EXISTS backups (slot TEXT PRIMARY KEY, bytes BLOB NOT NULL, metadata TEXT NOT NULL); PRAGMA user_version=2; COMMIT;").map_err(error)?;
        let meta: Option<String> = db
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(error)?;
        let uninitialized = meta.is_none();
        let mut sync_state =
            json!({"dirty":false,"etag":null,"synced_revision":null,"last_synced_at":null});
        let engine = if let Some(meta) = meta {
            let meta: Value = serde_json::from_str(&meta).map_err(error)?;
            if meta["sync"].is_object() {
                sync_state = meta["sync"].clone();
            } else {
                // Earlier experimental databases have no proof of upload.
                sync_state["dirty"] = json!(true);
            }
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
        if uninitialized {
            let rows: i64 = db
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM records)+(SELECT COUNT(*) FROM receipts)",
                    [],
                    |r| r.get(0),
                )
                .map_err(error)?;
            if rows != 0 {
                return Err("Missing metadata in a nonempty database; recovery required".into());
            }
            let s = &engine.snapshot;
            let meta = json!({"header":{"schema_version":s.schema_version,"exported_at":s.exported_at,"device_id":s.device_id,"settings":s.settings},"revision":0,"generation":1,"next_id":1,"sync":sync_state});
            db.execute("INSERT INTO meta(id,value) VALUES(1,?)", [meta.to_string()])
                .map_err(error)?;
        }
        Ok(Self {
            db,
            engine,
            sync_state,
        })
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
        let mut sync = self.sync_state.clone();
        sync["dirty"] = json!(true);
        self.commit_with(pending, sync, None)
    }
    fn commit_with(
        &mut self,
        pending: Prepared,
        sync: Value,
        undo: Option<(Vec<u8>, Value)>,
    ) -> Result<Receipt, String> {
        let writes = lift_engine::write_set(&self.engine, &pending)?;
        let tx = self.db.transaction().map_err(error)?;
        let stored: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(error)?;
        let stored = stored
            .map(|s| serde_json::from_str::<Value>(&s).map_err(error))
            .transpose()?;
        if stored
            .as_ref()
            .is_some_and(|v| v["sync"].is_object() && v["sync"] != self.sync_state)
        {
            return Err("Concurrent sync metadata update; reopen required".into());
        }
        let stored_generation = stored
            .as_ref()
            .and_then(|v| v["generation"].as_u64())
            .unwrap_or(1);
        if stored_generation != pending.base_generation {
            return Err("Concurrent dataset replacement; reopen required".into());
        }
        let current = stored
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
        let meta = json!({"header":writes.header,"revision":writes.revision,"generation":writes.generation,"next_id":writes.next_id,"sync":sync});
        tx.execute("INSERT INTO meta(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[meta.to_string()]).map_err(error)?;
        tx.execute(
            "INSERT INTO receipts(generation,command_id,value) VALUES(?,?,?)",
            rusqlite::params![
                pending.receipt.generation,
                pending.receipt.command_id,
                serde_json::to_string(&pending.receipt).map_err(error)?
            ],
        )
        .map_err(error)?;
        if let Some((bytes, metadata)) = undo {
            tx.execute("INSERT INTO backups(slot,bytes,metadata) VALUES('undo',?,?) ON CONFLICT(slot) DO UPDATE SET bytes=excluded.bytes,metadata=excluded.metadata",rusqlite::params![bytes,metadata.to_string()]).map_err(error)?;
        }
        tx.commit().map_err(error)?;
        self.sync_state = sync;
        self.engine.publish(pending)
    }
    pub fn import_file(&mut self, request: &crate::ImportRequest) -> Result<Receipt, String> {
        if self.engine.generation != request.generation {
            return Err("Stale dataset generation".into());
        }
        if let Some(receipt) = self.receipt(&request.command_id)? {
            if receipt.payload
                != lift_engine::import_identity(&request.format, &request.text, request.replace)
            {
                return Err("Import ID reused with different content".into());
            }
            return Ok(receipt);
        }
        if self.engine.revision != request.revision {
            return Err("Dataset changed since import preview".into());
        }
        let pending = self.engine.prepare_import(
            request.command_id.clone(),
            &request.format,
            &request.text,
            request.replace,
            lift_domain::commands::Context {
                now: request.now.clone(),
                today: request.today.clone(),
                next_id: self.engine.next_id,
            },
        )?;
        if request.replace {
            let undo = self.snapshot_bytes(&request.now)?;
            let meta = json!({"savedAt":request.now,"generation":self.engine.generation,"revision":self.engine.revision});
            let mut sync = self.sync_state.clone();
            sync["dirty"] = json!(true);
            sync["last_restore_revision"] = Value::Null;
            self.commit_with(pending, sync, Some((undo, meta)))
        } else {
            self.commit(pending)
        }
    }
    pub fn acknowledge_push(
        &mut self,
        generation: u64,
        revision: u64,
        expected_etag: Option<&str>,
        etag: &str,
        now: &str,
    ) -> Result<(), String> {
        let sync = lift_engine::sync::acknowledge_push(
            &self.sync_state,
            (self.engine.generation, self.engine.revision),
            (generation, revision),
            expected_etag,
            etag,
            now,
        )?;
        let tx = self.db.transaction().map_err(error)?;
        let original: String = tx
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .map_err(error)?;
        let mut meta: Value = serde_json::from_str(&original).map_err(error)?;
        if meta["generation"].as_u64() != Some(self.engine.generation)
            || meta["revision"].as_u64() != Some(self.engine.revision)
            || (meta["sync"].is_object() && meta["sync"] != self.sync_state)
        {
            return Err("Stored sync state changed; reopen required".into());
        }
        meta["sync"] = sync.clone();
        tx.execute("UPDATE meta SET value=? WHERE id=1", [meta.to_string()])
            .map_err(error)?;
        tx.commit().map_err(error)?;
        self.sync_state = sync;
        Ok(())
    }
    pub fn snapshot_bytes(&self, now: &str) -> Result<Vec<u8>, String> {
        lift_codec::encode(
            &serde_json::to_value(&self.engine.snapshot).map_err(error)?,
            now,
        )
        .map_err(error)
    }
    pub fn replace_snapshot(
        &mut self,
        bytes: &[u8],
        expected_generation: u64,
        expected_revision: u64,
        remote_etag: Option<String>,
        now: &str,
    ) -> Result<Receipt, String> {
        if self.engine.generation != expected_generation
            || self.engine.revision != expected_revision
        {
            return Err("Dataset changed since replacement was requested".into());
        }
        if remote_etag.as_deref().is_some_and(str::is_empty) {
            return Err("Missing remote ETag".into());
        }
        let (value, migrated) = lift_codec::decode(bytes, 128 * 1024 * 1024).map_err(error)?;
        let mut snapshot: Snapshot = serde_json::from_value(value).map_err(error)?;
        if migrated {
            lift_domain::prs::recompute(&mut snapshot, None);
        }
        let payload = json!({"op":"replace_snapshot","source":if remote_etag.is_some(){"remote"}else{"local"}});
        let pending = self.engine.prepare_replacement(
            format!("replace-{}-{}", expected_generation, expected_revision),
            snapshot,
            payload,
        )?;
        let is_remote = remote_etag.is_some();
        let keep_undo = !is_remote
            && self.sync_state["last_restore_revision"].as_u64() == Some(self.engine.revision);
        let mut sync = self.sync_state.clone();
        sync["last_restore_revision"] = if is_remote {
            Value::Null
        } else {
            json!(pending.receipt.revision)
        };
        if let Some(etag) = remote_etag {
            sync["etag"] = json!(etag);
            sync["dirty"] = json!(false);
            sync["synced_revision"] = json!(pending.receipt.revision);
            sync["last_synced_at"] = json!(now);
        } else {
            sync["dirty"] = json!(true);
        }
        let undo = self.snapshot_bytes(now)?;
        let metadata = json!({"savedAt":now,"generation":self.engine.generation,"revision":self.engine.revision,"workouts":self.engine.snapshot.workouts.len(),"sets":self.engine.snapshot.sets.iter().filter(|s|!s.is_planned).count()});
        self.commit_with(
            pending,
            sync,
            if keep_undo {
                None
            } else {
                Some((undo, metadata))
            },
        )
    }
    pub fn save_restore_point(&mut self, now: &str) -> Result<(), String> {
        let time = lift_domain::prs::timestamp_checked(now).ok_or("Invalid restore point time")?;
        let bytes = self.snapshot_bytes(now)?;
        let meta = json!({"savedAt":now,"workouts":self.engine.snapshot.workouts.len(),"sets":self.engine.snapshot.sets.iter().filter(|s|!s.is_planned).count(),"revision":self.engine.revision,"generation":self.engine.generation});
        let tx = self.db.transaction().map_err(error)?;
        let stored: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(error)?;
        if let Some(stored) = stored {
            let stored: Value = serde_json::from_str(&stored).map_err(error)?;
            if stored["revision"].as_u64() != Some(self.engine.revision)
                || stored["generation"].as_u64() != Some(self.engine.generation)
            {
                return Err("Dataset changed before restore point capture".into());
            }
        }
        let read = |slot: &str| -> Result<Option<(Vec<u8>, String)>, String> {
            tx.query_row(
                "SELECT bytes,metadata FROM backups WHERE slot=?",
                [slot],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(error)
        };
        let current = read("current")?;
        let previous = read("bak")?;
        let daily = read("bak2")?;
        let daily_old = daily
            .as_ref()
            .and_then(|(_, s)| serde_json::from_str::<Value>(s).ok())
            .and_then(|v| {
                v["savedAt"]
                    .as_str()
                    .and_then(lift_domain::prs::timestamp_checked)
            })
            .is_none_or(|t| time.saturating_sub(t) >= 86_400_000);
        let write = |slot: &str, bytes: &[u8], metadata: &str| -> Result<(), String> {
            tx.execute("INSERT INTO backups(slot,bytes,metadata) VALUES(?,?,?) ON CONFLICT(slot) DO UPDATE SET bytes=excluded.bytes,metadata=excluded.metadata",rusqlite::params![slot,bytes,metadata]).map_err(error)?;
            Ok(())
        };
        if current.is_some() && daily_old {
            if let Some((bytes, meta)) = &previous {
                write("bak2", bytes, meta)?;
            }
        }
        if let Some((bytes, meta)) = &current {
            write("bak", bytes, meta)?;
        }
        write("current", &bytes, &meta.to_string())?;
        tx.commit().map_err(error)?;
        Ok(())
    }
    pub fn restore_points(&self) -> Result<Value, String> {
        let mut stmt = self
            .db
            .prepare("SELECT slot,metadata FROM backups")
            .map_err(error)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(error)?;
        let mut out = serde_json::Map::new();
        for row in rows {
            let (slot, meta) = row.map_err(error)?;
            out.insert(slot, serde_json::from_str(&meta).map_err(error)?);
        }
        Ok(Value::Object(out))
    }
    pub fn backup_bytes(&self, slot: &str) -> Result<Option<Vec<u8>>, String> {
        self.db
            .query_row("SELECT bytes FROM backups WHERE slot=?", [slot], |r| {
                r.get(0)
            })
            .optional()
            .map_err(error)
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
            base_generation: 1,
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

#[cfg(test)]
mod replacement_tests {
    use super::*;
    fn note(text: &str) -> Command {
        Command::SetDayNote {
            date: "2026-01-01".into(),
            text: text.into(),
        }
    }
    #[test]
    fn remote_adoption_local_restore_undo_and_stale_retries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.sqlite");
        let mut store = Store::open(path.to_str().unwrap(), "device".into(), "now".into()).unwrap();
        store
            .execute(
                "a".into(),
                1,
                note("original"),
                "now".into(),
                "2026-01-01".into(),
            )
            .unwrap();
        let original = store.snapshot_bytes("now").unwrap();
        store
            .execute(
                "b".into(),
                1,
                note("new"),
                "now".into(),
                "2026-01-01".into(),
            )
            .unwrap();
        store
            .replace_snapshot(&original, 1, 2, Some("etag-1".into()), "sync-time")
            .unwrap();
        assert_eq!(store.engine.generation, 2);
        assert_eq!(store.sync_state["dirty"], false);
        assert_eq!(store.sync_state["etag"], "etag-1");
        let undo = store.backup_bytes("undo").unwrap().unwrap();
        let undo_value = lift_codec::decode(&undo, 1024 * 1024).unwrap().0;
        assert_eq!(undo_value["day_notes"][0]["text"], "new");
        store
            .replace_snapshot(&undo, 2, 3, None, "restore-time")
            .unwrap();
        assert_eq!(store.sync_state["dirty"], true);
        assert_eq!(store.sync_state["etag"], "etag-1");
        assert_eq!(store.engine.snapshot.day_notes[0].text, "new");
        let stable_undo = store.backup_bytes("undo").unwrap().unwrap();
        store
            .replace_snapshot(&undo, 3, 4, None, "restore-again")
            .unwrap();
        assert_eq!(store.backup_bytes("undo").unwrap().unwrap(), stable_undo);
        assert!(store
            .execute(
                "a".into(),
                1,
                note("original"),
                "now".into(),
                "2026-01-01".into()
            )
            .is_err());
        assert!(store
            .replace_snapshot(&original, 4, 999, Some("bad".into()), "now")
            .is_err());
        assert!(store
            .replace_snapshot(b"corrupt", 4, 5, Some("bad".into()), "now")
            .is_err());
        drop(store);
        let store = Store::open(path.to_str().unwrap(), "device".into(), "now".into()).unwrap();
        assert_eq!(store.engine.generation, 4);
        assert_eq!(store.engine.revision, 5);
        assert_eq!(store.sync_state["etag"], "etag-1");
        assert_eq!(store.sync_state["dirty"], true);
    }
}

#[cfg(test)]
mod import_tests {
    use super::*;
    #[test]
    fn import_is_atomic_and_retryable() {
        let mut store = Store::open(":memory:", "device".into(), "now".into()).unwrap();
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/engine-parity/json-import.json"
        ))
        .unwrap();
        let mut request = crate::ImportRequest {
            command_id: "import-one".into(),
            generation: 1,
            revision: 0,
            format: "json".into(),
            text: fixture["traces"][0]["data"].to_string(),
            replace: false,
            now: fixture["now"].as_str().unwrap().into(),
            today: fixture["today"].as_str().unwrap().into(),
        };
        store.db.execute_batch("CREATE TRIGGER fail_commit BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        assert!(store.import_file(&request).is_err());
        assert_eq!(store.engine.revision, 0);
        assert!(store.engine.snapshot.sets.is_empty());
        assert!(store.receipt("import-one").unwrap().is_none());
        store.db.execute_batch("DROP TRIGGER fail_commit;").unwrap();
        let first = store.import_file(&request).unwrap();
        assert_eq!(store.engine.revision, 1);
        assert!(!store.engine.snapshot.sets.is_empty());
        assert_eq!(
            store.import_file(&request).unwrap().revision,
            first.revision
        );
        request.text = "invalid json".into();
        assert!(store.import_file(&request).is_err());
        assert_eq!(store.engine.revision, 1);
        request.command_id = "replacement".into();
        request.revision = 1;
        request.replace = true;
        assert!(store.import_file(&request).is_err());
        assert_eq!(store.engine.generation, 1);
        assert!(store.backup_bytes("undo").unwrap().is_none());
    }
    #[test]
    fn late_push_and_failed_replace_preserve_data_and_metadata() {
        let mut store = Store::open(":memory:", "device".into(), "now".into()).unwrap();
        let note = |s: &str| Command::SetDayNote {
            date: "2026-01-01".into(),
            text: s.into(),
        };
        store
            .execute("a".into(), 1, note("a"), "now".into(), "today".into())
            .unwrap();
        let old = store.snapshot_bytes("now").unwrap();
        store
            .execute("b".into(), 1, note("b"), "now".into(), "today".into())
            .unwrap();
        store.acknowledge_push(1, 1, None, "etag-a", "now").unwrap();
        assert_eq!(store.sync_state["dirty"], true);
        let sync = store.sync_state.clone();
        store.db.execute_batch("CREATE TRIGGER fail_backup BEFORE INSERT ON backups BEGIN SELECT RAISE(ABORT,'backup failure'); END;").unwrap();
        assert!(store
            .replace_snapshot(&old, 1, 2, Some("etag-remote".into()), "now")
            .is_err());
        assert_eq!(store.sync_state, sync);
        assert_eq!(store.engine.generation, 1);
        assert_eq!(store.engine.snapshot.day_notes[0].text, "b");
        assert!(store.backup_bytes("undo").unwrap().is_none());
    }
}

#[cfg(test)]
mod rotation_tests {
    use super::*;
    #[test]
    fn daily_copy_keeps_its_age_while_previous_moves() {
        let mut store = Store::open(":memory:", "device".into(), "now".into()).unwrap();
        store.save_restore_point("2026-01-01T00:00:00Z").unwrap();
        store.save_restore_point("2026-01-01T01:00:00Z").unwrap();
        store.save_restore_point("2026-01-01T02:00:00Z").unwrap();
        assert_eq!(
            store.restore_points().unwrap()["bak2"]["savedAt"],
            "2026-01-01T00:00:00Z"
        );
        store.save_restore_point("2026-01-01T03:00:00Z").unwrap();
        let meta = store.restore_points().unwrap();
        assert_eq!(meta["bak"]["savedAt"], "2026-01-01T02:00:00Z");
        assert_eq!(meta["bak2"]["savedAt"], "2026-01-01T00:00:00Z");
        store.save_restore_point("2026-01-02T00:00:00Z").unwrap();
        assert_eq!(
            store.restore_points().unwrap()["bak2"]["savedAt"],
            "2026-01-01T02:00:00Z"
        );
        assert!(store.save_restore_point("invalid").is_err());
    }
}
