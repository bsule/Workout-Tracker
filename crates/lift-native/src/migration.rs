//! One-way activation: read legacy files, build and verify a separate SQLite
//! database, then atomically install it. Legacy files are never modified or
//! deleted.
//!
//! The legacy load matches the TypeScript hydrate: `snapshot.bin`, `.bak`
//! and `.bak2` are tried in that order until one parses, `pending.log` is
//! replayed onto it, a newer schema stops everything, and no readable copy is
//! an error rather than an empty account.
use crate::error::{Fail, Kind, Result};
use crate::storage::{backups_path, open_backups, write_backup, Store};
use lift_domain::model::Snapshot;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const CANDIDATES: [&str; 3] = ["snapshot.bin", "snapshot.bin.bak", "snapshot.bin.bak2"];
const MAX_EXPANDED: usize = 128 * 1024 * 1024;
const STAGING_PREFIX: &str = ".lift-migration-";

/// What the host knew about the legacy store, from outside the snapshot.
#[derive(Default, Debug, Clone)]
pub struct Legacy {
    pub etag: Option<String>,
    pub last_synced_at: Option<String>,
}
impl Legacy {
    /// `{"etag": string|null}`; unknown keys and unreadable input are ignored.
    pub fn parse(json: &str) -> Self {
        let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
        let text = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(str::to_string);
        Self {
            etag: text("etag"),
            last_synced_at: text("lastSyncedAt").or_else(|| text("last_synced_at")),
        }
    }
}

fn sibling(target: &Path, suffix: &str) -> PathBuf {
    let mut name = target.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}
fn sync_dir(dir: &Path) {
    // Makes the rename durable. Not every file system supports it.
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}
/// Removes staging databases an interrupted migration left behind.
fn clean_staging(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with(STAGING_PREFIX) {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .is_some_and(|age| age > Duration::from_secs(600));
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}
/// Moves a database and its journal files aside, never deleting them.
fn move_aside(target: &Path, suffix: &str) -> Result<()> {
    let mut aside = sibling(target, suffix);
    if aside.exists() {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        aside = sibling(target, &format!("{suffix}-{stamp}"));
    }
    for extra in ["-wal", "-shm"] {
        let from = sibling(target, extra);
        if from.exists() {
            fs::rename(&from, sibling(&aside, extra)).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(target, &aside).map_err(|e| e.to_string())?;
    Ok(())
}

fn pending_text(dir: &Path) -> Result<Option<String>> {
    let path = dir.join("pending.log");
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok((!text.trim().is_empty()).then_some(text))
}

/// The legacy dataset in `dir`, or None when there is none.
fn read_legacy(dir: &Path, device: &str, now: &str) -> Result<Option<Snapshot>> {
    let pending = pending_text(dir)?;
    let mut found = false;
    let mut chosen: Option<(Value, bool)> = None;
    let mut typed: Option<(Snapshot, bool)> = None;
    for name in CANDIDATES {
        let path = dir.join(name);
        if !path.exists() {
            continue;
        }
        found = true;
        let Ok(bytes) = fs::read(&path) else { continue };
        if pending.is_some() {
            match lift_codec::decode(&bytes, MAX_EXPANDED) {
                Ok(v) => {
                    chosen = Some(v);
                    break;
                }
                Err(lift_codec::CodecError::TooNew(v)) => {
                    return Err(Fail::too_new(format!(
                        "Snapshot schema {v} requires a newer app"
                    )))
                }
                Err(_) => continue,
            }
        } else {
            match lift_codec::decode_snapshot(&bytes, MAX_EXPANDED) {
                Ok(v) => {
                    typed = Some(v);
                    break;
                }
                Err(lift_codec::CodecError::TooNew(v)) => {
                    return Err(Fail::too_new(format!(
                        "Snapshot schema {v} requires a newer app"
                    )))
                }
                Err(_) => continue,
            }
        }
    }
    if found && chosen.is_none() && typed.is_none() {
        return Err(Fail::corrupt(
            "No readable legacy snapshot; originals retained",
        ));
    }
    let (mut snapshot, migrated) = if let Some(pending) = pending {
        let (source, migrated) = chosen.unwrap_or_else(|| {
            (
                serde_json::to_value(Snapshot::empty(device.into(), now.into()))
                    .expect("empty snapshot serializes"),
                false,
            )
        });
        let replayed = lift_codec::replay::replay(source, &pending, now)
            .map_err(|e| Fail::corrupt(e.to_string()))?;
        let snapshot: Snapshot =
            serde_json::from_value(replayed).map_err(|e| Fail::corrupt(e.to_string()))?;
        (snapshot, migrated)
    } else if let Some(t) = typed {
        t
    } else {
        return Ok(None);
    };
    if migrated {
        lift_domain::prs::recompute(&mut snapshot, None);
    }
    lift_domain::model::repair(&mut snapshot);
    lift_domain::model::validate(&snapshot).map_err(Fail::corrupt)?;
    Ok(Some(snapshot))
}

fn has_rows(s: &Snapshot) -> bool {
    !(s.exercises.is_empty()
        && s.workouts.is_empty()
        && s.workout_exercises.is_empty()
        && s.sets.is_empty()
        && s.gyms.is_empty()
        && s.day_notes.is_empty())
}

/// An engine database that holds no rows and no record of the user removing
/// any, beside legacy data: the early engine builds opened an empty database
/// when adoption of the legacy store failed. Returns the database's etag.
fn empty_engine_beside_legacy(target: &Path) -> Result<Option<Option<String>>> {
    let db = rusqlite::Connection::open(target)?;
    let tables: i64 = db.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('records','receipts','meta')",
        [],
        |r| r.get(0),
    )?;
    if tables < 3 {
        return Ok(None);
    }
    let rows: i64 = db.query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))?;
    if rows != 0 {
        return Ok(None);
    }
    let mut stmt = db.prepare("SELECT value FROM receipts")?;
    let receipts = stmt.query_map([], |r| r.get::<_, String>(0))?;
    for receipt in receipts {
        let v: Value = serde_json::from_str(&receipt?).unwrap_or(Value::Null);
        let payload = &v["payload"];
        let destructive = match payload["op"].as_str().unwrap_or("") {
            "delete_workout" | "delete_sets" | "remove_exercise" | "delete_exercise"
            | "delete_gym" | "replace_snapshot" | "import_file" => true,
            "set_day_note" => payload["text"].as_str().is_none_or(|t| t.trim().is_empty()),
            _ => false,
        };
        if destructive {
            return Ok(None);
        }
    }
    let meta: Option<String> = db
        .query_row("SELECT value FROM meta WHERE id=1", [], |r| r.get(0))
        .optional()?;
    let etag = meta
        .and_then(|m| serde_json::from_str::<Value>(&m).ok())
        .and_then(|m| m["sync"]["etag"].as_str().map(str::to_string));
    Ok(Some(etag))
}
use rusqlite::OptionalExtension;

/// Legacy restore-point metadata (restore-points.json), reconciled with each
/// file's modification time as `reconcileMeta` does.
fn legacy_restore_points(dir: &Path) -> Vec<(&'static str, Vec<u8>, Value)> {
    let stored: Value = fs::read_to_string(dir.join("restore-points.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null);
    let mut out = vec![];
    for (slot, name) in [
        ("current", "snapshot.bin"),
        ("bak", "snapshot.bin.bak"),
        ("bak2", "snapshot.bin.bak2"),
        ("undo", "snapshot.bin.undo"),
    ] {
        let path = dir.join(name);
        let Ok(bytes) = fs::read(&path) else { continue };
        // A copy that cannot be read is no way back; leave it on disk only.
        if lift_codec::decode_snapshot(&bytes, MAX_EXPANDED).is_err() {
            continue;
        }
        let mtime = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let entry = &stored[slot];
        let saved = entry["savedAt"]
            .as_str()
            .and_then(lift_domain::prs::timestamp_checked);
        let meta = if entry.is_object() && saved.is_some_and(|t| (mtime - t).abs() <= 15_000) {
            json!({"savedAt":entry["savedAt"],"workouts":entry["workouts"],"sets":entry["sets"]})
        } else {
            json!({"savedAt":lift_domain::prs::iso_from_ms(mtime),"workouts":null,"sets":null})
        };
        out.push((slot, bytes, meta));
    }
    out
}

/// Builds and verifies a database holding `snapshot`, then installs it at
/// `target`, which must not exist.
pub(crate) fn install(
    target: &Path,
    snapshot: Snapshot,
    device: &str,
    now: &str,
    etag: Option<String>,
    last_synced_at: Option<String>,
) -> Result<()> {
    let directory = target.parent().ok_or("Database needs a parent directory")?;
    let staging = tempfile::Builder::new()
        .prefix(STAGING_PREFIX)
        .tempfile_in(directory)
        .map_err(|e| e.to_string())?;
    let path = staging.path().to_str().ok_or("Invalid staging path")?;
    let mut store = Store::open_at(path, ":memory:", device.into(), now.into())?;
    store.install_snapshot(snapshot.clone(), etag, last_synced_at)?;
    store.checkpoint()?;
    drop(store);
    let verified = Store::open_at(path, ":memory:", device.into(), now.into())?;
    if verified.engine.snapshot() != &snapshot {
        return Err("Database verification failed".into());
    }
    verified.checkpoint()?;
    drop(verified);
    staging.as_file().sync_all().map_err(|e| e.to_string())?;
    staging
        .persist_noclobber(target)
        .map_err(|e| e.error.to_string())?;
    sync_dir(directory);
    Ok(())
}

/// Runs the one-time legacy migration when `target` does not exist yet, or
/// when it is an empty engine database beside legacy data. Returns whether a
/// migration ran.
pub fn migrate_if_needed(target: &Path, device: &str, now: &str, legacy: &Legacy) -> Result<bool> {
    let directory = target.parent().ok_or("Database needs a parent directory")?;
    if !directory.exists() {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    }
    clean_staging(directory);
    let mut etag = legacy.etag.clone();
    if target.exists() {
        let Some(existing_etag) = (match empty_engine_beside_legacy(target) {
            Ok(v) => v,
            // Damage is handled by the store's own recovery.
            Err(e) if e.kind == Kind::Corrupt => return Ok(false),
            Err(e) => return Err(e),
        }) else {
            return Ok(false);
        };
        let legacy_data = match read_legacy(directory, device, now) {
            Ok(Some(s)) if has_rows(&s) => s,
            // Nothing to recover, or legacy files the old app could not load
            // either: keep the engine database as it is.
            _ => return Ok(false),
        };
        // Never overwrite an etag the engine already holds.
        if existing_etag.is_some() {
            etag = existing_etag;
        }
        move_aside(target, ".empty")?;
        let backups = open_backups(&backups_path(target.to_str().ok_or("Invalid path")?))?;
        carry_restore_points(&backups, directory)?;
        drop(backups);
        install(
            target,
            legacy_data,
            device,
            now,
            etag,
            legacy.last_synced_at.clone(),
        )?;
        return Ok(true);
    }
    let Some(snapshot) = read_legacy(directory, device, now)? else {
        return Ok(false);
    };
    let backups = open_backups(&backups_path(target.to_str().ok_or("Invalid path")?))?;
    carry_restore_points(&backups, directory)?;
    drop(backups);
    install(
        target,
        snapshot,
        device,
        now,
        etag,
        legacy.last_synced_at.clone(),
    )?;
    Ok(true)
}
fn carry_restore_points(backups: &rusqlite::Connection, dir: &Path) -> Result<()> {
    for (slot, bytes, meta) in legacy_restore_points(dir) {
        write_backup(backups, slot, &bytes, &meta)?;
    }
    Ok(())
}

/// Replaces a damaged database with the newest readable restore point.
/// The damaged files are kept as `<db>.corrupt`. With no readable restore
/// point nothing changes and the error says so.
pub fn recover_from_backups(target: &Path, device: &str, now: &str) -> Result<()> {
    let path = target.to_str().ok_or("Invalid path")?;
    let backups_file = backups_path(path);
    if !Path::new(&backups_file).exists() {
        return Err(Fail::corrupt(
            "Local database is damaged and no restore point exists",
        ));
    }
    let backups = open_backups(&backups_file).map_err(|e| Fail::corrupt(e.message))?;
    for slot in ["current", "bak", "bak2", "undo"] {
        let bytes: Option<Vec<u8>> = backups
            .query_row("SELECT bytes FROM backups WHERE slot=?", [slot], |r| {
                r.get(0)
            })
            .optional()
            .unwrap_or(None);
        let Some(bytes) = bytes else { continue };
        let (mut snapshot, migrated) = match lift_codec::decode_snapshot(&bytes, MAX_EXPANDED) {
            Ok(v) => v,
            Err(lift_codec::CodecError::TooNew(v)) => {
                return Err(Fail::too_new(format!(
                    "Snapshot schema {v} requires a newer app"
                )))
            }
            Err(_) => continue,
        };
        if migrated {
            lift_domain::prs::recompute(&mut snapshot, None);
        }
        lift_domain::model::repair(&mut snapshot);
        if lift_domain::model::validate(&snapshot).is_err() {
            continue;
        }
        drop(backups);
        move_aside(target, ".corrupt")?;
        install(target, snapshot, device, now, None, None)?;
        return Ok(());
    }
    Err(Fail::corrupt(
        "Local database is damaged and no restore point could be read",
    ))
}

#[cfg(test)]
mod tests;
