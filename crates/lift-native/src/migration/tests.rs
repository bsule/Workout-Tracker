use super::*;
use crate::error::Kind;
use lift_domain::model::DayNoteRow;
use std::io::Write;

fn gz(v: &Value) -> Vec<u8> {
    let mut gzip = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
    gzip.write_all(v.to_string().as_bytes()).unwrap();
    gzip.finish().unwrap()
}
fn legacy(note: &str) -> Snapshot {
    let mut s = Snapshot::empty("legacy-device".into(), "2026-01-01T00:00:00.000Z".into());
    s.day_notes.push(DayNoteRow {
        date: "2026-01-01".into(),
        text: note.into(),
    });
    s
}
fn bytes(s: &Snapshot) -> Vec<u8> {
    lift_codec::encode_snapshot(s, &s.exported_at).unwrap()
}
fn open(db: &Path) -> Store {
    Store::open(db.to_str().unwrap(), "new-device".into(), "now".into()).unwrap()
}
fn none() -> Legacy {
    Legacy::default()
}

#[test]
fn migration_preserves_originals_and_reopens_verified_data() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("engine.sqlite");
    let b = bytes(&legacy("old"));
    fs::write(dir.path().join("snapshot.bin"), &b).unwrap();
    fs::write(
        dir.path().join("pending.log"),
        "{\"op\":\"set_day_note\",\"date\":\"2026-01-01\",\"text\":\"replayed\"}\nnot json\n",
    )
    .unwrap();
    let legacy_sync = Legacy::parse(r#"{"etag":"cloud-1","extra":true}"#);
    assert!(migrate_if_needed(&db, "new-device", "now", &legacy_sync).unwrap());
    let store = open(&db);
    assert_eq!(store.engine.snapshot().day_notes[0].text, "replayed");
    assert_eq!(store.engine.snapshot().device_id, "legacy-device");
    assert_eq!(store.sync_state["etag"], "cloud-1");
    assert_eq!(store.sync_state["dirty"], true);
    assert_eq!(fs::read(dir.path().join("snapshot.bin")).unwrap(), b);
    assert!(dir.path().join("pending.log").exists());
    drop(store);
    // Later opens never migrate again or touch the etag.
    let other = Legacy::parse(r#"{"etag":"cloud-2"}"#);
    assert!(!migrate_if_needed(&db, "new-device", "now", &other).unwrap());
    assert_eq!(open(&db).sync_state["etag"], "cloud-1");
}

#[test]
fn future_snapshot_does_not_activate_an_empty_database() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    let mut v = serde_json::to_value(Snapshot::empty("device".into(), "now".into())).unwrap();
    v["schema_version"] = json!(100);
    fs::write(dir.path().join("snapshot.bin"), gz(&v)).unwrap();
    // An older readable copy must not be loaded in its place.
    fs::write(dir.path().join("snapshot.bin.bak"), bytes(&legacy("older"))).unwrap();
    let err = migrate_if_needed(&target, "device", "now", &none()).unwrap_err();
    assert_eq!(err.kind, Kind::TooNew);
    assert!(!target.exists());
    assert!(!Path::new(&backups_path(target.to_str().unwrap())).exists());
}

#[test]
fn falls_back_through_bak_and_bak2_and_replays_pending() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    fs::write(dir.path().join("snapshot.bin"), b"torn").unwrap();
    fs::write(dir.path().join("snapshot.bin.bak"), b"also torn").unwrap();
    fs::write(
        dir.path().join("snapshot.bin.bak2"),
        bytes(&legacy("daily")),
    )
    .unwrap();
    fs::write(
        dir.path().join("pending.log"),
        "{\"op\":\"create_gym\",\"row\":{\"id\":7,\"name\":\"Golds\"}}\n{\"op\":\"create_gym\",\"row\":null}\n",
    )
    .unwrap();
    assert!(migrate_if_needed(&target, "device", "now", &none()).unwrap());
    let store = open(&target);
    assert_eq!(store.engine.snapshot().day_notes[0].text, "daily");
    assert_eq!(store.engine.snapshot().gyms[0].name, "Golds");
    assert_eq!(fs::read(dir.path().join("snapshot.bin")).unwrap(), b"torn");
}

#[test]
fn all_copies_corrupt_is_an_error_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    fs::write(dir.path().join("snapshot.bin"), b"torn").unwrap();
    fs::write(dir.path().join("snapshot.bin.bak"), b"torn").unwrap();
    let err = migrate_if_needed(&target, "device", "now", &none()).unwrap_err();
    assert_eq!(err.kind, Kind::Corrupt);
    assert!(!target.exists());
}

#[test]
fn legacy_restore_points_carry_into_engine_slots() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    fs::write(dir.path().join("snapshot.bin"), bytes(&legacy("now"))).unwrap();
    fs::write(
        dir.path().join("snapshot.bin.bak"),
        bytes(&legacy("previous")),
    )
    .unwrap();
    fs::write(
        dir.path().join("snapshot.bin.bak2"),
        bytes(&legacy("daily")),
    )
    .unwrap();
    fs::write(dir.path().join("snapshot.bin.undo"), bytes(&legacy("undo"))).unwrap();
    let mtime = |n: &str| {
        let t = fs::metadata(dir.path().join(n))
            .unwrap()
            .modified()
            .unwrap();
        lift_domain::prs::iso_from_ms(
            t.duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        )
        .unwrap()
    };
    let meta = json!({
        "bak": {"savedAt": mtime("snapshot.bin.bak"), "workouts": 3, "sets": 12},
        // Does not match the file: replaced by its mtime, counts unknown.
        "bak2": {"savedAt": "2001-01-01T00:00:00.000Z", "workouts": 9, "sets": 9}
    });
    fs::write(dir.path().join("restore-points.json"), meta.to_string()).unwrap();
    migrate_if_needed(&target, "device", "now", &none()).unwrap();
    let store = open(&target);
    let points = store.restore_points().unwrap();
    for slot in ["current", "bak", "bak2", "undo"] {
        assert!(points[slot]["savedAt"].is_string(), "{slot}");
        assert!(store.backup_bytes(slot).unwrap().is_some(), "{slot}");
    }
    assert_eq!(points["bak"]["sets"], 12);
    assert_eq!(points["bak2"]["sets"], Value::Null);
    let undo = store.backup_bytes("undo").unwrap().unwrap();
    assert_eq!(
        lift_codec::decode_snapshot(&undo, 1 << 20)
            .unwrap()
            .0
            .day_notes[0]
            .text,
        "undo"
    );
    for name in [
        "snapshot.bin",
        "snapshot.bin.bak",
        "snapshot.bin.bak2",
        "snapshot.bin.undo",
    ] {
        assert!(dir.path().join(name).exists());
    }
}

#[test]
fn migration_recomputes_prs_and_dedupes_gyms() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    let f: Value =
        serde_json::from_str(include_str!("../../../../tests/engine-parity/prs.json")).unwrap();
    let mut input = f[0]["input"].clone();
    input["schema_version"] = json!(7);
    input["gyms"] =
        json!([{"id":901,"name":"Golds"},{"id":902,"name":"Golds"},{"id":903,"name":"golds"}]);
    fs::write(dir.path().join("snapshot.bin"), gz(&input)).unwrap();
    migrate_if_needed(&target, "device", "now", &none()).unwrap();
    let store = open(&target);
    let expected: Snapshot = serde_json::from_value(f[0]["expected"].clone()).unwrap();
    let flags = |s: &Snapshot| {
        s.sets
            .iter()
            .map(|x| (x.id, x.is_pr, x.was_pr, x.is_position_pr, x.was_position_pr))
            .collect::<Vec<_>>()
    };
    assert_eq!(flags(store.engine.snapshot()), flags(&expected));
    let names: Vec<_> = store
        .engine
        .snapshot()
        .gyms
        .iter()
        .map(|g| g.name.clone())
        .collect();
    assert_eq!(names, ["Golds", "golds"]);
}

#[test]
fn snapshot_typescript_could_load_still_migrates() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    let input = json!({
        "schema_version": 9, "exported_at": null, "device_id": "d",
        "settings": null,
        "exercises": [{"id":63,"name":"Mine","category":"chest","kind":"weight_reps","is_custom":true},
                      {"id":63,"name":"Also mine","category":"chest","kind":"weight_reps","is_custom":true}],
        "workouts": [{"id":1,"date":"2026-01-01","status":"done","started_at":null,"finished_at":null,"gym":null,"notes":null,"created_at":"2026-01-01T10:00:00"}],
        "workout_exercises": [{"id":2,"workout_id":1,"exercise_id":63,"order":0.0}],
        "sets": [{"id":3,"workout_exercise_id":2,"weight":100,"reps":5,"order":0,"created_at":"2026-01-01T10:00:00","is_position_pr":null}],
        "gyms": [],
        "day_notes": [{"date":"2026-01-01","text":"a"},{"date":"2026-01-01","text":"b"}]
    });
    fs::write(dir.path().join("snapshot.bin"), gz(&input)).unwrap();
    migrate_if_needed(&target, "device", "now", &none()).unwrap();
    let store = open(&target);
    let s = store.engine.snapshot();
    // The last row keeps the shared id, as the TypeScript id map resolved.
    assert_eq!(
        s.exercises.iter().find(|e| e.id == 63).unwrap().name,
        "Also mine"
    );
    assert_eq!(s.exercises.len(), 2);
    assert!(s.exercises.iter().all(|e| e.id >= 63));
    assert_eq!(s.day_notes.len(), 1);
    assert_eq!(s.day_notes[0].text, "a");
    // A current-version snapshot keeps its stored flags, as hydrate does.
    assert!(!s.sets[0].is_pr);
}

fn empty_engine(target: &Path) {
    let store = Store::open(target.to_str().unwrap(), "d".into(), "now".into()).unwrap();
    drop(store);
}

#[test]
fn empty_engine_database_beside_legacy_data_is_migrated() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    empty_engine(&target);
    {
        // The early build synced once and kept the cloud etag.
        let mut s = Store::open(target.to_str().unwrap(), "d".into(), "now".into()).unwrap();
        s.acknowledge_push(1, 0, None, "engine-etag", "now")
            .unwrap();
    }
    fs::write(dir.path().join("snapshot.bin"), bytes(&legacy("history"))).unwrap();
    let legacy_sync = Legacy::parse(r#"{"etag":"legacy-etag"}"#);
    assert!(migrate_if_needed(&target, "d", "now", &legacy_sync).unwrap());
    let store = open(&target);
    assert_eq!(store.engine.snapshot().day_notes[0].text, "history");
    assert_eq!(store.sync_state["etag"], "engine-etag");
    assert!(dir.path().join("engine.sqlite.empty").exists());
}

#[test]
fn engine_database_with_user_rows_or_deletions_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    fs::write(dir.path().join("snapshot.bin"), bytes(&legacy("history"))).unwrap();
    {
        let mut s = Store::open(target.to_str().unwrap(), "d".into(), "now".into()).unwrap();
        s.execute(
            "a".into(),
            1,
            lift_domain::commands::Command::CreateGym { name: "G".into() },
            "now".into(),
            "today".into(),
        )
        .unwrap();
        s.execute(
            "b".into(),
            1,
            lift_domain::commands::Command::DeleteGym { id: 1 },
            "now".into(),
            "today".into(),
        )
        .unwrap();
    }
    assert!(!migrate_if_needed(&target, "d", "now", &none()).unwrap());
    assert!(open(&target).engine.snapshot().day_notes.is_empty());
}

#[test]
fn damaged_database_falls_back_to_newest_restore_point() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    {
        let mut s = Store::open(target.to_str().unwrap(), "d".into(), "now".into()).unwrap();
        s.execute(
            "a".into(),
            1,
            lift_domain::commands::Command::SetDayNote {
                date: "2026-01-01".into(),
                text: "saved".into(),
            },
            "now".into(),
            "today".into(),
        )
        .unwrap();
        s.save_restore_point("2026-01-01T00:00:00Z").unwrap();
        s.checkpoint().unwrap();
    }
    fs::write(
        &target,
        b"this is not a database at all, just garbage bytes......",
    )
    .unwrap();
    let engine = crate::NativeEngine::open(
        target.to_str().unwrap().into(),
        "d".into(),
        "now".into(),
        "{}".into(),
    )
    .unwrap();
    let points = engine
        .query(r#"{"kind":"day_note","date":"2026-01-01"}"#.into())
        .unwrap();
    assert!(points.contains("saved"), "{points}");
    assert!(dir.path().join("engine.sqlite.corrupt").exists());
}

#[test]
fn damaged_database_without_restore_point_is_reported_and_kept() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("engine.sqlite");
    fs::write(
        &target,
        b"this is not a database at all, just garbage bytes......",
    )
    .unwrap();
    let err = crate::NativeEngine::open(
        target.to_str().unwrap().into(),
        "d".into(),
        "now".into(),
        "{}".into(),
    )
    .err()
    .unwrap();
    assert!(matches!(err, crate::EngineError::Corrupt { .. }), "{err:?}");
    assert!(target.exists());
}

#[test]
fn stale_staging_files_are_removed() {
    let dir = tempfile::tempdir().unwrap();
    let stale = dir.path().join(".lift-migration-abc");
    fs::write(&stale, b"x").unwrap();
    let old = SystemTime::now() - Duration::from_secs(3600);
    fs::File::options()
        .write(true)
        .open(&stale)
        .unwrap()
        .set_modified(old)
        .unwrap();
    let fresh = dir.path().join(".lift-migration-def");
    fs::write(&fresh, b"x").unwrap();
    migrate_if_needed(&dir.path().join("engine.sqlite"), "d", "now", &none()).unwrap();
    assert!(!stale.exists());
    assert!(fresh.exists());
}
