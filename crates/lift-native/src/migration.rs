//! One-way activation: read legacy files, build and verify a separate SQLite
//! database, then atomically install it. Original files remain untouched.
use crate::storage::Store;
use lift_domain::model::Snapshot;
use std::{fs, path::Path};

pub fn migrate_if_needed(target: &Path, device: &str, now: &str) -> Result<(), String> {
    if target.exists() {
        return Ok(());
    }
    let directory = target.parent().ok_or("Database needs a parent directory")?;
    if !directory.exists() {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    }
    let candidates = ["snapshot.bin", "snapshot.bin.bak", "snapshot.bin.bak2"];
    let mut found = false;
    let mut source = None;
    let mut migrated = false;
    for name in candidates {
        let path = directory.join(name);
        if !path.exists() {
            continue;
        }
        found = true;
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        match lift_codec::decode(&bytes, 128 * 1024 * 1024) {
            Ok((snapshot, changed)) => {
                source = Some(snapshot);
                migrated = changed;
                break;
            }
            Err(lift_codec::CodecError::TooNew(v)) => {
                return Err(format!("Snapshot schema {v} requires a newer app"))
            }
            Err(_) => continue,
        }
    }
    if found && source.is_none() {
        return Err("No readable legacy snapshot; originals retained".into());
    }
    let pending = directory.join("pending.log");
    if source.is_none() && !pending.exists() {
        return Ok(());
    }
    let source = source.unwrap_or_else(|| {
        serde_json::to_value(Snapshot::empty(device.into(), now.into())).unwrap()
    });
    let source = if pending.exists() {
        let text = fs::read_to_string(pending).map_err(|e| e.to_string())?;
        lift_codec::replay::replay(source, &text, now).map_err(|e| e.to_string())?
    } else {
        source
    };
    let mut snapshot: Snapshot = serde_json::from_value(source).map_err(|e| e.to_string())?;
    if migrated {
        lift_domain::prs::recompute(&mut snapshot, None);
    }
    // Legacy exact-name duplicate gyms are repaired without changing workouts.
    let mut names = std::collections::HashSet::new();
    snapshot.gyms.retain(|g| names.insert(g.name.clone()));
    lift_domain::model::validate(&snapshot)?;
    let staging = tempfile::Builder::new()
        .prefix(".lift-migration-")
        .tempfile_in(directory)
        .map_err(|e| e.to_string())?;
    let path = staging.path().to_str().ok_or("Invalid staging path")?;
    let mut store = Store::open(path, device.into(), now.into())?;
    store.install_snapshot(snapshot.clone())?;
    store.checkpoint()?;
    drop(store);
    let verified = Store::open(path, device.into(), now.into())?;
    if verified.engine.snapshot() != &snapshot {
        return Err("Legacy migration verification failed".into());
    }
    verified.checkpoint()?;
    drop(verified);
    staging.as_file().sync_all().map_err(|e| e.to_string())?;
    staging
        .persist_noclobber(target)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_originals_and_reopens_verified_data() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("engine.sqlite");
        let mut snapshot =
            Snapshot::empty("legacy-device".into(), "2026-01-01T00:00:00.000Z".into());
        snapshot.day_notes.push(lift_domain::model::DayNoteRow {
            date: "2026-01-01".into(),
            text: "old".into(),
        });
        let bytes = lift_codec::encode(
            &serde_json::to_value(&snapshot).unwrap(),
            &snapshot.exported_at,
        )
        .unwrap();
        fs::write(dir.path().join("snapshot.bin"), &bytes).unwrap();
        fs::write(
            dir.path().join("pending.log"),
            "{\"op\":\"set_day_note\",\"date\":\"2026-01-01\",\"text\":\"replayed\"}\n",
        )
        .unwrap();
        migrate_if_needed(&db, "new-device", "now").unwrap();
        let store = Store::open(db.to_str().unwrap(), "new-device".into(), "now".into()).unwrap();
        assert_eq!(store.engine.snapshot().day_notes[0].text, "replayed");
        assert_eq!(store.engine.snapshot().device_id, "legacy-device");
        assert_eq!(fs::read(dir.path().join("snapshot.bin")).unwrap(), bytes);
        assert!(dir.path().join("pending.log").exists());
        drop(store);
        migrate_if_needed(&db, "new-device", "now").unwrap();
    }
    #[test]
    fn future_snapshot_does_not_activate_an_empty_database() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("engine.sqlite");
        let mut v = serde_json::to_value(Snapshot::empty("device".into(), "now".into())).unwrap();
        // Encode stamps current version; write future schema explicitly.
        v["schema_version"] = serde_json::json!(100);
        use std::io::Write;
        let mut gzip = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
        gzip.write_all(v.to_string().as_bytes()).unwrap();
        fs::write(dir.path().join("snapshot.bin"), gzip.finish().unwrap()).unwrap();
        assert!(migrate_if_needed(&target, "device", "now").is_err());
        assert!(!target.exists());
    }
}
