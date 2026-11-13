//! Transactional native record storage. Derived in-memory state is published
//! only after SQLite commits records, revision, allocator and receipt together.
//!
//! Restore points live in a second database file beside the live one
//! (`<db>.backups`), so damage to one cannot take both. A restore's undo copy
//! is written there before the replacement commits, as the TypeScript store
//! wrote its undo file first.
use crate::error::{Fail, Result};
use lift_domain::{
    commands::Command,
    model::{
        DayNoteRow, ExerciseRow, GymRow, SetRow, Snapshot, WorkoutExerciseRow, WorkoutRow,
        SCHEMA_VERSION,
    },
    table::Table,
};
use lift_engine::{row_changes, Engine, Prepared, Receipt};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

/// Native database format. 3: restore points moved to `<db>.backups`;
/// ordinals no longer equal positions. 4: rows are stored in the binary
/// encoding of `rows.rs` instead of JSON text.
pub const DB_VERSION: i64 = 4;
/// The last version whose rows are JSON text.
const LAST_JSON_VERSION: i64 = 3;
const RECEIPTS_KEPT: i64 = 2000;
const PRUNE_EVERY: u64 = 64;

pub fn backups_path(path: &str) -> String {
    if path.is_empty() || path == ":memory:" {
        ":memory:".into()
    } else {
        format!("{path}.backups")
    }
}
fn configure(db: &Connection) -> Result<()> {
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
    Ok(())
}
pub fn open_backups(path: &str) -> Result<Connection> {
    let db = Connection::open(path)?;
    configure(&db)?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS backups (slot TEXT PRIMARY KEY, bytes BLOB NOT NULL, metadata TEXT NOT NULL);",
    )?;
    Ok(db)
}
pub fn write_backup(db: &Connection, slot: &str, bytes: &[u8], metadata: &Value) -> Result<()> {
    db.execute(
        "INSERT INTO backups(slot,bytes,metadata) VALUES(?,?,?) ON CONFLICT(slot) DO UPDATE SET bytes=excluded.bytes,metadata=excluded.metadata",
        rusqlite::params![slot, bytes, metadata.to_string()],
    )?;
    Ok(())
}
fn corrupt(e: impl std::fmt::Display) -> Fail {
    Fail::corrupt(format!("Damaged local database: {e}"))
}
fn load_table<T: crate::rows::Row>(db: &Connection, kind: &str) -> Result<Table<T>> {
    let mut stmt =
        db.prepare("SELECT value, ordinal FROM records WHERE kind=? ORDER BY ordinal")?;
    let mut rows = stmt.query([kind])?;
    let mut out = vec![];
    while let Some(row) = rows.next()? {
        let bytes = row.get_ref(0)?.as_blob().map_err(corrupt)?;
        let ordinal: i64 = row.get(1)?;
        out.push((ordinal, crate::rows::decode::<T>(bytes).map_err(corrupt)?));
    }
    Ok(Table::from_ordered(out))
}
fn binary_row(kind: &str, json: &str) -> Result<Vec<u8>> {
    use crate::rows::encode;
    fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T> {
        serde_json::from_str(json).map_err(corrupt)
    }
    Ok(match kind {
        "exercises" => encode(&parse::<ExerciseRow>(json)?),
        "workouts" => encode(&parse::<WorkoutRow>(json)?),
        "workout_exercises" => encode(&parse::<WorkoutExerciseRow>(json)?),
        "sets" => encode(&parse::<SetRow>(json)?),
        "gyms" => encode(&parse::<GymRow>(json)?),
        "day_notes" => encode(&parse::<DayNoteRow>(json)?),
        other => return Err(corrupt(format!("unknown table {other}"))),
    })
}
/// Rewrites every JSON row of a version 1-3 database in the binary
/// encoding, in one IMMEDIATE transaction: a failure rolls back and leaves
/// the old database exactly as it was, still openable by the app that made it.
fn upgrade_rows(db: &Connection) -> Result<()> {
    db.execute_batch("BEGIN IMMEDIATE;")?;
    let run = || -> Result<()> {
        db.execute_batch("CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(kind,key));")?;
        let rows: Vec<(i64, String, String)> = {
            let mut stmt = db.prepare("SELECT rowid, kind, value FROM records")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let mut update = db.prepare("UPDATE records SET value=? WHERE rowid=?")?;
        for (rowid, kind, json) in rows {
            update.execute(rusqlite::params![binary_row(&kind, &json)?, rowid])?;
        }
        db.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS records_order ON records(kind, ordinal); PRAGMA user_version={DB_VERSION}; COMMIT;"
        ))?;
        Ok(())
    };
    run().inspect_err(|_| {
        let _ = db.execute_batch("ROLLBACK;");
    })
}
fn encode_row(row: lift_engine::RowRef) -> Vec<u8> {
    use crate::rows::encode;
    use lift_engine::RowRef::*;
    match row {
        Exercise(r) => encode(r),
        Workout(r) => encode(r),
        WorkoutExercise(r) => encode(r),
        Set(r) => encode(r),
        Gym(r) => encode(r),
        DayNote(r) => encode(r),
    }
}

/// Everything a restore-point or upload encoder needs, captured under the
/// engine lock so the gzip work can run without it.
pub struct Capture {
    pub snapshot: Snapshot,
    pub generation: u64,
    pub revision: u64,
}
impl Capture {
    pub fn metadata(&self, now: &str) -> Value {
        json!({"savedAt":now,"workouts":self.snapshot.workouts.len(),"sets":self.snapshot.sets.iter().filter(|s|!s.is_planned).count(),"revision":self.revision,"generation":self.generation})
    }
    pub fn encode(&self, now: &str) -> Result<Vec<u8>> {
        Ok(lift_codec::encode_snapshot(&self.snapshot, now)?)
    }
}

/// A replacement checked against the current dataset, waiting for its bytes
/// to be decoded and the outgoing data encoded as undo.
pub struct ReplaceStart {
    pub id: String,
    pub payload: Value,
    pub generation: u64,
    pub revision: u64,
    pub remote_etag: Option<String>,
    /// Data to keep in the undo slot; None keeps the current undo copy.
    pub undo: Option<Capture>,
}
pub struct ReplaceReady {
    start: ReplaceStart,
    snapshot: Snapshot,
    undo: Option<(Vec<u8>, Value)>,
}
impl ReplaceStart {
    /// Decodes the incoming bytes and encodes the undo copy. Runs unlocked.
    pub fn decode(self, bytes: &[u8], now: &str) -> Result<ReplaceReady> {
        let (mut snapshot, migrated) = lift_codec::decode_snapshot(bytes, 128 * 1024 * 1024)?;
        if migrated {
            lift_domain::prs::recompute(&mut snapshot, None);
        }
        let undo = match &self.undo {
            Some(c) => Some((c.encode(now)?, c.metadata(now))),
            None => None,
        };
        Ok(ReplaceReady {
            start: self,
            snapshot,
            undo,
        })
    }
}

pub struct Store {
    db: Connection,
    backups: Connection,
    pub engine: Engine,
    pub sync_state: Value,
    pub installation_device_id: String,
    commits: u64,
}
impl Store {
    pub fn open(path: &str, device_id: String, now: String) -> Result<Self> {
        Self::open_at(path, &backups_path(path), device_id, now)
    }
    pub fn open_at(path: &str, backups: &str, device_id: String, now: String) -> Result<Self> {
        let db = Connection::open(path)?;
        configure(&db)?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > DB_VERSION {
            return Err(Fail::too_new("Local database is from a newer app"));
        }
        if (1..=LAST_JSON_VERSION).contains(&version) {
            upgrade_rows(&db)?;
        }
        db.execute_batch(&format!("BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(kind,key)); CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (generation INTEGER NOT NULL, command_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(generation,command_id)); CREATE INDEX IF NOT EXISTS receipts_command ON receipts(command_id); CREATE INDEX IF NOT EXISTS records_order ON records(kind, ordinal); PRAGMA user_version={DB_VERSION}; COMMIT;"))?;
        let backups = open_backups(backups)?;
        Self::move_backups_out(&db, &backups)?;
        let meta: Option<String> = db
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()?;
        let uninitialized = meta.is_none();
        let mut sync_state =
            json!({"dirty":false,"etag":null,"synced_revision":null,"last_synced_at":null});
        let mut repaired: Option<Prepared> = None;
        let engine = if let Some(meta) = meta {
            let meta: Value = serde_json::from_str(&meta).map_err(corrupt)?;
            if meta["sync"].is_object() {
                sync_state = meta["sync"].clone();
            } else {
                // Earlier experimental databases have no proof of upload.
                sync_state["dirty"] = json!(true);
            }
            let mut snapshot =
                serde_json::from_value::<lift_domain::model::Header>(meta["header"].clone())
                    .map_err(corrupt)?
                    .into_snapshot();
            if snapshot.schema_version > SCHEMA_VERSION {
                return Err(Fail::too_new("Local data is from a newer app"));
            }
            snapshot.exercises = load_table::<ExerciseRow>(&db, "exercises")?;
            snapshot.workouts = load_table::<WorkoutRow>(&db, "workouts")?;
            snapshot.workout_exercises =
                load_table::<WorkoutExerciseRow>(&db, "workout_exercises")?;
            snapshot.sets = load_table::<SetRow>(&db, "sets")?;
            snapshot.gyms = load_table::<GymRow>(&db, "gyms")?;
            snapshot.day_notes = load_table::<DayNoteRow>(&db, "day_notes")?;
            let mut fixed = snapshot.clone();
            let changed = lift_domain::model::repair(&mut fixed);
            let revision = meta["revision"]
                .as_u64()
                .ok_or_else(|| corrupt("invalid revision"))?;
            let generation = meta["generation"]
                .as_u64()
                .ok_or_else(|| corrupt("invalid generation"))?;
            let next_id = meta["next_id"]
                .as_u64()
                .ok_or_else(|| corrupt("invalid allocator"))?;
            let mut engine =
                Engine::new(snapshot, revision, generation, next_id).map_err(corrupt)?;
            // PR flags this engine derived and verified in earlier sessions.
            if meta["verified"]["rules"].as_u64()
                == Some(lift_domain::lookup::Verified::RULES.into())
            {
                if let Ok(v) = serde_json::from_value(meta["verified"]["state"].clone()) {
                    engine.restore_verified(v);
                }
            }
            if changed {
                // Repair can renumber rows, which moves PR tie-breaks.
                engine.restore_verified(Default::default());
                repaired = Some(engine.prepare_repair(fixed)?);
            }
            engine
        } else {
            Engine::new(Snapshot::empty(device_id.clone(), now), 0, 1, 1)?
        };
        if uninitialized {
            let rows: i64 = db.query_row(
                "SELECT (SELECT COUNT(*) FROM records)+(SELECT COUNT(*) FROM receipts)",
                [],
                |r| r.get(0),
            )?;
            if rows != 0 {
                return Err(corrupt("missing metadata in a nonempty database"));
            }
            let meta = json!({"header":lift_engine::header(engine.snapshot()),"revision":0,"generation":1,"next_id":1,"sync":sync_state});
            db.execute("INSERT INTO meta(id,value) VALUES(1,?)", [meta.to_string()])?;
        }
        let mut store = Self {
            db,
            backups,
            engine,
            sync_state,
            installation_device_id: device_id,
            commits: 0,
        };
        if let Some(pending) = repaired {
            store.write_repair(pending)?;
        }
        Ok(store)
    }
    /// Databases before version 3 kept restore points in the live file.
    fn move_backups_out(db: &Connection, backups: &Connection) -> Result<()> {
        let has: i64 = db.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='backups'",
            [],
            |r| r.get(0),
        )?;
        if has == 0 {
            return Ok(());
        }
        let rows: Vec<(String, Vec<u8>, String)> = {
            let mut stmt = db.prepare("SELECT slot,bytes,metadata FROM backups")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let tx = backups.unchecked_transaction()?;
        for (slot, bytes, metadata) in rows {
            tx.execute(
                "INSERT OR REPLACE INTO backups(slot,bytes,metadata) VALUES(?,?,?)",
                rusqlite::params![slot, bytes, metadata],
            )?;
        }
        tx.commit()?;
        db.execute_batch("DROP TABLE backups;")?;
        Ok(())
    }
    /// Persists rows `repair` dropped on load, without a new revision: the
    /// data is the same, minus duplicates nothing could tell apart.
    fn write_repair(&mut self, pending: Prepared) -> Result<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        Self::write_rows(&tx, &pending)?;
        tx.commit()?;
        self.engine.publish(pending)?;
        Ok(())
    }
    fn write_rows(tx: &rusqlite::Transaction, pending: &Prepared) -> Result<()> {
        let mut upsert = tx.prepare_cached("INSERT INTO records(kind,key,value,ordinal) VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,ordinal=excluded.ordinal")?;
        let mut delete = tx.prepare_cached("DELETE FROM records WHERE kind=? AND key=?")?;
        for change in row_changes(pending) {
            match change.value {
                Some(row) => {
                    upsert.execute(rusqlite::params![
                        change.table,
                        change.key,
                        encode_row(row),
                        change.ordinal
                    ])?;
                }
                None => {
                    delete.execute(rusqlite::params![change.table, change.key])?;
                }
            }
        }
        Ok(())
    }
    /// The newest receipt for a command id, whatever its generation, so a
    /// retry after a lost acknowledgement finds a commit that replaced the
    /// dataset too.
    pub fn receipt(&self, id: &str) -> Result<Option<Receipt>> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM receipts WHERE command_id=? ORDER BY generation DESC LIMIT 1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        value
            .map(|s| serde_json::from_str(&s).map_err(corrupt))
            .transpose()
    }
    pub fn execute(
        &mut self,
        id: String,
        generation: u64,
        command: Command,
        now: String,
        today: String,
    ) -> Result<Receipt> {
        if let Some(receipt) = self.receipt(&id)? {
            if receipt.payload != serde_json::to_value(&command).map_err(|e| e.to_string())? {
                return Err("Command ID reused with different payload".into());
            }
            return Ok(receipt);
        }
        if generation != self.engine.generation {
            return Err(Fail::stale("Stale dataset generation"));
        }
        let pending = self.engine.prepare(id, command, now, today)?;
        self.commit(pending)
    }
    fn commit(&mut self, pending: Prepared) -> Result<Receipt> {
        let mut sync = self.sync_state.clone();
        sync["dirty"] = json!(true);
        self.commit_with(pending, sync)
    }
    fn commit_with(&mut self, pending: Prepared, sync: Value) -> Result<Receipt> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored: Option<String> = tx
            .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
            .optional()?;
        let stored = stored
            .map(|s| serde_json::from_str::<Value>(&s).map_err(corrupt))
            .transpose()?;
        if stored
            .as_ref()
            .is_some_and(|v| v["sync"].is_object() && v["sync"] != self.sync_state)
        {
            return Err(Fail::stale(
                "Concurrent sync metadata update; reopen required",
            ));
        }
        let stored_generation = stored
            .as_ref()
            .and_then(|v| v["generation"].as_u64())
            .unwrap_or(1);
        if stored_generation != pending.base_generation {
            return Err(Fail::stale(
                "Concurrent dataset replacement; reopen required",
            ));
        }
        let current = stored
            .map(|v| v["revision"].as_u64().unwrap_or(u64::MAX))
            .unwrap_or(0);
        if current != pending.base_revision {
            return Err(Fail::stale(
                "Concurrent writer changed revision; reopen required",
            ));
        }
        Self::write_rows(&tx, &pending)?;
        let verified = self.engine.verified_after(&pending);
        let meta = json!({"header":lift_engine::header(&pending.snapshot),"revision":pending.receipt.revision,"generation":pending.receipt.generation,"next_id":pending.next_id,"sync":sync,"verified":{"rules":lift_domain::lookup::Verified::RULES,"state":verified}});
        tx.execute("INSERT INTO meta(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[meta.to_string()])?;
        tx.execute(
            "INSERT OR REPLACE INTO receipts(generation,command_id,value) VALUES(?,?,?)",
            rusqlite::params![
                pending.receipt.generation,
                pending.receipt.command_id,
                serde_json::to_string(&pending.receipt).map_err(|e| e.to_string())?
            ],
        )?;
        if (self.commits + 1) % PRUNE_EVERY == 0 {
            // A retry follows its lost acknowledgement within seconds; the
            // newest receipts are all a retry can still need.
            tx.execute(
                "DELETE FROM receipts WHERE rowid <= (SELECT MAX(rowid) FROM receipts) - ?",
                [RECEIPTS_KEPT],
            )?;
        }
        tx.commit()?;
        self.commits += 1;
        self.sync_state = sync;
        Ok(self.engine.publish(pending)?)
    }
    pub fn capture(&self) -> Capture {
        Capture {
            snapshot: self.engine.snapshot().clone(),
            generation: self.engine.generation,
            revision: self.engine.revision,
        }
    }
    /// An import. A replacing import needs `undo`, the encoded data it
    /// replaces, captured at the current revision.
    pub fn import_file(
        &mut self,
        request: &crate::ImportRequest,
        undo: Option<(Vec<u8>, Value, u64, u64)>,
    ) -> Result<Receipt> {
        if let Some(receipt) = self.receipt(&request.command_id)? {
            if receipt.payload
                != lift_engine::import_identity(&request.format, &request.text, request.replace)
            {
                return Err("Import ID reused with different content".into());
            }
            return Ok(receipt);
        }
        if self.engine.generation != request.generation {
            return Err(Fail::stale("Stale dataset generation"));
        }
        if self.engine.revision != request.revision {
            return Err(Fail::stale("Dataset changed since import preview"));
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
            let (bytes, metadata, generation, revision) = match undo {
                Some(u) => u,
                None => {
                    let c = self.capture();
                    (
                        c.encode(&request.now)?,
                        c.metadata(&request.now),
                        c.generation,
                        c.revision,
                    )
                }
            };
            if generation != self.engine.generation || revision != self.engine.revision {
                return Err(Fail::stale("Dataset changed since import preview"));
            }
            write_backup(&self.backups, "undo", &bytes, &metadata)?;
            let mut sync = self.sync_state.clone();
            sync["dirty"] = json!(true);
            sync["last_restore_revision"] = Value::Null;
            self.commit_with(pending, sync)
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
    ) -> Result<()> {
        if etag.is_empty() {
            return Err("Missing upload ETag".into());
        }
        let sync = lift_engine::sync::acknowledge_push(
            &self.sync_state,
            (self.engine.generation, self.engine.revision),
            (generation, revision),
            expected_etag,
            etag,
            now,
        )
        .map_err(Fail::stale)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let original: String =
            tx.query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))?;
        let mut meta: Value = serde_json::from_str(&original).map_err(corrupt)?;
        if meta["generation"].as_u64() != Some(self.engine.generation)
            || meta["revision"].as_u64() != Some(self.engine.revision)
            || (meta["sync"].is_object() && meta["sync"] != self.sync_state)
        {
            return Err(Fail::stale("Stored sync state changed; reopen required"));
        }
        meta["sync"] = sync.clone();
        tx.execute("UPDATE meta SET value=? WHERE id=1", [meta.to_string()])?;
        tx.commit()?;
        self.sync_state = sync;
        Ok(())
    }
    #[cfg(test)]
    pub fn snapshot_bytes(&self, now: &str) -> Result<Vec<u8>> {
        Ok(lift_codec::encode_snapshot(self.engine.snapshot(), now)?)
    }
    /// The checks a replacement makes before any work: a retry of a
    /// replacement that already committed returns its receipt.
    pub fn begin_replace(
        &self,
        bytes: &[u8],
        expected_generation: u64,
        expected_revision: u64,
        remote_etag: Option<String>,
    ) -> Result<std::result::Result<Receipt, ReplaceStart>> {
        let id = format!("replace-{expected_generation}-{expected_revision}");
        let payload = json!({"op":"replace_snapshot","source":if remote_etag.is_some(){"remote"}else{"local"},"sha256":lift_engine::sha256_hex(bytes)});
        if let Some(receipt) = self.receipt(&id)? {
            if receipt.payload == payload {
                return Ok(Ok(receipt));
            }
            return Err(Fail::stale(
                "Dataset changed since replacement was requested",
            ));
        }
        if self.engine.generation != expected_generation
            || self.engine.revision != expected_revision
        {
            return Err(Fail::stale(
                "Dataset changed since replacement was requested",
            ));
        }
        if remote_etag.as_deref().is_some_and(str::is_empty) {
            return Err("Missing remote ETag".into());
        }
        // A second local restore with no edits in between keeps the undo
        // copy from before the first one.
        let keep_undo = remote_etag.is_none()
            && self.sync_state["last_restore_revision"].as_u64() == Some(self.engine.revision);
        Ok(Err(ReplaceStart {
            id,
            payload,
            generation: expected_generation,
            revision: expected_revision,
            remote_etag,
            undo: (!keep_undo).then(|| self.capture()),
        }))
    }
    pub fn finish_replace(&mut self, ready: ReplaceReady, now: &str) -> Result<Receipt> {
        let ReplaceReady {
            start,
            snapshot,
            undo,
        } = ready;
        if self.engine.generation != start.generation || self.engine.revision != start.revision {
            return Err(Fail::stale(
                "Dataset changed since replacement was requested",
            ));
        }
        let pending = self
            .engine
            .prepare_replacement(start.id, snapshot, start.payload)?;
        let mut sync = self.sync_state.clone();
        sync["last_restore_revision"] = if start.remote_etag.is_some() {
            Value::Null
        } else {
            json!(pending.receipt.revision)
        };
        if let Some(etag) = start.remote_etag {
            sync["etag"] = json!(etag);
            sync["dirty"] = json!(false);
            sync["synced_revision"] = json!(pending.receipt.revision);
            sync["last_synced_at"] = json!(now);
        } else {
            sync["dirty"] = json!(true);
        }
        if let Some((bytes, metadata)) = undo {
            write_backup(&self.backups, "undo", &bytes, &metadata)?;
        }
        self.commit_with(pending, sync)
    }
    #[cfg(test)]
    pub fn replace_snapshot(
        &mut self,
        bytes: &[u8],
        expected_generation: u64,
        expected_revision: u64,
        remote_etag: Option<String>,
        now: &str,
    ) -> Result<Receipt> {
        match self.begin_replace(bytes, expected_generation, expected_revision, remote_etag)? {
            Ok(receipt) => Ok(receipt),
            Err(start) => {
                let ready = start.decode(bytes, now)?;
                self.finish_replace(ready, now)
            }
        }
    }
    #[cfg(test)]
    pub fn save_restore_point(&mut self, now: &str) -> Result<()> {
        let capture = self.capture();
        let bytes = capture.encode(now)?;
        self.write_restore_point(&bytes, capture.metadata(now), now)
    }
    /// Rotates the restore points: current moves to the previous slot, and
    /// the previous one to the daily slot once that is a day old. Right after
    /// a restore the daily slot is held, so the restore's own copy cannot
    /// push a fresh file into it.
    pub fn write_restore_point(&mut self, bytes: &[u8], meta: Value, now: &str) -> Result<()> {
        let time = lift_domain::prs::timestamp_checked(now).ok_or("Invalid restore point time")?;
        let hold_daily =
            self.sync_state["last_restore_revision"].as_u64() == Some(self.engine.revision);
        let tx = self
            .backups
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let read = |slot: &str| -> Result<Option<(Vec<u8>, String)>> {
            Ok(tx
                .query_row(
                    "SELECT bytes,metadata FROM backups WHERE slot=?",
                    [slot],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?)
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
        let write = |slot: &str, bytes: &[u8], metadata: &str| -> Result<()> {
            tx.execute("INSERT INTO backups(slot,bytes,metadata) VALUES(?,?,?) ON CONFLICT(slot) DO UPDATE SET bytes=excluded.bytes,metadata=excluded.metadata",rusqlite::params![slot,bytes,metadata])?;
            Ok(())
        };
        if !hold_daily && current.is_some() && daily_old {
            if let Some((bytes, meta)) = &previous {
                write("bak2", bytes, meta)?;
            }
        }
        if let Some((bytes, meta)) = &current {
            write("bak", bytes, meta)?;
        }
        write("current", bytes, &meta.to_string())?;
        tx.commit()?;
        Ok(())
    }
    pub fn restore_points(&self) -> Result<Value> {
        let mut stmt = self.backups.prepare("SELECT slot,metadata FROM backups")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = serde_json::Map::new();
        for row in rows {
            let (slot, meta) = row?;
            out.insert(
                slot,
                serde_json::from_str(&meta).map_err(|e| e.to_string())?,
            );
        }
        Ok(Value::Object(out))
    }
    pub fn backup_bytes(&self, slot: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .backups
            .query_row("SELECT bytes FROM backups WHERE slot=?", [slot], |r| {
                r.get(0)
            })
            .optional()?)
    }
    pub(crate) fn checkpoint(&self) -> Result<()> {
        let (busy, log, remaining): (i64, i64, i64) =
            self.db
                .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })?;
        if busy != 0 || log != remaining {
            return Err("Database checkpoint incomplete".into());
        }
        Ok(())
    }
    /// Installs the first dataset of a new database: a migrated legacy store
    /// or a recovered restore point. `etag` is the cloud version that data
    /// was last in agreement with, if known.
    pub(crate) fn install_snapshot(
        &mut self,
        snapshot: Snapshot,
        etag: Option<String>,
        last_synced_at: Option<String>,
    ) -> Result<()> {
        if self.engine.revision != 0 {
            return Err("Store already initialized".into());
        }
        let pending = self.engine.prepare_initial(
            "__legacy_migration_v1".into(),
            snapshot,
            json!({"op":"legacy_migration"}),
        )?;
        let mut sync = self.sync_state.clone();
        sync["dirty"] = json!(true);
        sync["etag"] = json!(etag);
        if let Some(at) = last_synced_at {
            sync["last_synced_at"] = json!(at);
        }
        self.commit_with(pending, sync)?;
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn db(&self) -> &Connection {
        &self.db
    }
    #[cfg(test)]
    pub(crate) fn backups_db(&self) -> &Connection {
        &self.backups
    }
}
#[cfg(test)]
mod tests;
