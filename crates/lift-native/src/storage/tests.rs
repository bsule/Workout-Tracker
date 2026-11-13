use super::*;
use lift_domain::commands::Command;

fn note(text: &str) -> Command {
    Command::SetDayNote {
        date: "2026-01-01".into(),
        text: text.into(),
    }
}
fn memory() -> Store {
    Store::open(":memory:", "device".into(), "now".into()).unwrap()
}

#[test]
fn durable_receipt_and_payload_guard() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    let path = path.to_str().unwrap();
    let command = note("keep me");
    let mut store = Store::open(path, "device".into(), "now".into()).unwrap();
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
    let mut store = Store::open(path, "device".into(), "now".into()).unwrap();
    assert_eq!(store.engine.snapshot().day_notes[0].text, "keep me");
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
    let first = store
        .replace_snapshot(&original, 1, 2, Some("etag-1".into()), "sync-time")
        .unwrap();
    assert_eq!(store.engine.generation, 2);
    assert_eq!(store.sync_state["dirty"], false);
    assert_eq!(store.sync_state["etag"], "etag-1");
    // A retry after a lost acknowledgement returns the commit it made.
    let again = store
        .replace_snapshot(&original, 1, 2, Some("etag-1".into()), "sync-time")
        .unwrap();
    assert_eq!(again.revision, first.revision);
    assert_eq!(store.engine.generation, 2);
    let undo = store.backup_bytes("undo").unwrap().unwrap();
    let undo_value = lift_codec::decode(&undo, 1024 * 1024).unwrap().0;
    assert_eq!(undo_value["day_notes"][0]["text"], "new");
    store
        .replace_snapshot(&undo, 2, 3, None, "restore-time")
        .unwrap();
    assert_eq!(store.sync_state["dirty"], true);
    assert_eq!(store.sync_state["etag"], "etag-1");
    assert_eq!(store.engine.snapshot().day_notes[0].text, "new");
    let stable_undo = store.backup_bytes("undo").unwrap().unwrap();
    store
        .replace_snapshot(&undo, 3, 4, None, "restore-again")
        .unwrap();
    assert_eq!(store.backup_bytes("undo").unwrap().unwrap(), stable_undo);
    // A command committed before the replacements still returns its receipt.
    assert_eq!(
        store
            .execute(
                "a".into(),
                1,
                note("original"),
                "now".into(),
                "2026-01-01".into()
            )
            .unwrap()
            .revision,
        1
    );
    let stale = store
        .execute(
            "fresh".into(),
            1,
            note("x"),
            "now".into(),
            "2026-01-01".into(),
        )
        .unwrap_err();
    assert_eq!(stale.kind, crate::error::Kind::Stale);
    let stale = store
        .replace_snapshot(&original, 4, 999, Some("bad".into()), "now")
        .unwrap_err();
    assert_eq!(stale.kind, crate::error::Kind::Stale);
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

#[test]
fn import_is_atomic_and_retryable() {
    let mut store = memory();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../tests/engine-parity/json-import.json"
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
    store.db().execute_batch("CREATE TRIGGER fail_commit BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert!(store.import_file(&request, None).is_err());
    assert_eq!(store.engine.revision, 0);
    assert!(store.engine.snapshot().sets.is_empty());
    assert!(store.receipt("import-one").unwrap().is_none());
    store
        .db()
        .execute_batch("DROP TRIGGER fail_commit;")
        .unwrap();
    let first = store.import_file(&request, None).unwrap();
    assert_eq!(store.engine.revision, 1);
    assert!(!store.engine.snapshot().sets.is_empty());
    assert_eq!(
        store.import_file(&request, None).unwrap().revision,
        first.revision
    );
    request.text = "invalid json".into();
    assert!(store.import_file(&request, None).is_err());
    assert_eq!(store.engine.revision, 1);
    request.command_id = "replacement".into();
    request.revision = 1;
    request.replace = true;
    assert!(store.import_file(&request, None).is_err());
    assert_eq!(store.engine.generation, 1);
    assert!(store.backup_bytes("undo").unwrap().is_none());
    // A replacing import retried after its acknowledgement was lost.
    request.text = fixture["traces"][0]["data"].to_string();
    let replaced = store.import_file(&request, None).unwrap();
    assert_eq!(store.engine.generation, 2);
    assert_eq!(
        store.import_file(&request, None).unwrap().revision,
        replaced.revision
    );
    assert!(store.backup_bytes("undo").unwrap().is_some());
}

#[test]
fn late_push_and_failed_replace_preserve_data_and_metadata() {
    let mut store = memory();
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
    store.backups_db().execute_batch("CREATE TRIGGER fail_backup BEFORE INSERT ON backups BEGIN SELECT RAISE(ABORT,'backup failure'); END;").unwrap();
    assert!(store
        .replace_snapshot(&old, 1, 2, Some("etag-remote".into()), "now")
        .is_err());
    assert_eq!(store.sync_state, sync);
    assert_eq!(store.engine.generation, 1);
    assert_eq!(store.engine.snapshot().day_notes[0].text, "b");
    assert!(store.backup_bytes("undo").unwrap().is_none());
    let stale = store
        .acknowledge_push(9, 2, Some("etag-a"), "etag-b", "now")
        .unwrap_err();
    assert_eq!(stale.kind, crate::error::Kind::Stale);
}

#[test]
fn daily_copy_keeps_its_age_while_previous_moves() {
    let mut store = memory();
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

#[test]
fn restore_holds_the_daily_slot_for_its_own_save() {
    let mut store = memory();
    store
        .execute("a".into(), 1, note("a"), "now".into(), "today".into())
        .unwrap();
    store.save_restore_point("2026-01-01T00:00:00Z").unwrap();
    store.save_restore_point("2026-01-03T00:00:00Z").unwrap();
    let bytes = store.backup_bytes("current").unwrap().unwrap();
    store
        .replace_snapshot(&bytes, 1, 1, None, "2026-01-05T00:00:00Z")
        .unwrap();
    store.save_restore_point("2026-01-05T00:00:00Z").unwrap();
    // .bak2 did not take the minutes-old previous copy.
    assert!(store.restore_points().unwrap().get("bak2").is_none());
}

fn set_input(weight: f64, reps: f64) -> Value {
    json!({"weight":weight,"reps":reps})
}

#[test]
fn reopen_after_mid_table_delete_keeps_order_without_rewriting() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    let path = path.to_str().unwrap();
    let mut store = Store::open(path, "device".into(), "now".into()).unwrap();
    let mut n = 0;
    let mut cmd = |store: &mut Store, c: Command| {
        n += 1;
        store
            .execute(
                format!("c{n}"),
                store.engine.generation,
                c,
                "2026-01-01T00:00:00Z".into(),
                "2026-01-10".into(),
            )
            .unwrap()
    };
    let mut set_ids = vec![];
    for day in 1..=4 {
        let r = cmd(
            &mut store,
            Command::LogSet {
                date: format!("2026-01-0{day}"),
                exercise_id: 1,
                input: set_input(100.0 + day as f64, 5.0),
            },
        );
        set_ids.push(r.result["set_id"].as_u64().unwrap());
        for _ in 0..300 {
            let r = cmd(
                &mut store,
                Command::AddSet {
                    we_id: r.result["we_id"].as_u64().unwrap(),
                    input: set_input(50.0, 3.0),
                },
            );
            set_ids.push(r.result["id"].as_u64().unwrap());
        }
    }
    let before: Vec<u64> = store.engine.snapshot().sets.iter().map(|s| s.id).collect();
    let victim = set_ids[400];
    let written_before: i64 = store
        .db()
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    cmd(&mut store, Command::DeleteSets { ids: vec![victim] });
    let written: i64 = store
        .db()
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    // One delete, meta, receipt, and at most a few PR flag changes; never
    // the 800 rows after the deleted one.
    assert!(
        written - written_before < 20,
        "{}",
        written - written_before
    );
    // A set appended after the delete lands at the end on reopen.
    let we = store.engine.snapshot().workout_exercises[0].id;
    let added = cmd(
        &mut store,
        Command::AddSet {
            we_id: we,
            input: set_input(60.0, 2.0),
        },
    );
    let mut expected: Vec<u64> = before.into_iter().filter(|id| *id != victim).collect();
    expected.push(added.result["id"].as_u64().unwrap());
    let snapshot = store.engine.snapshot().clone();
    drop(store);
    let store = Store::open(path, "device".into(), "now".into()).unwrap();
    let reopened: Vec<u64> = store.engine.snapshot().sets.iter().map(|s| s.id).collect();
    assert_eq!(reopened, expected);
    assert_eq!(store.engine.snapshot(), &snapshot);
}

#[test]
fn backups_move_out_of_an_older_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    let path = path.to_str().unwrap();
    {
        let db = Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE backups (slot TEXT PRIMARY KEY, bytes BLOB NOT NULL, metadata TEXT NOT NULL); INSERT INTO backups VALUES('bak', x'01', '{\"savedAt\":\"2026-01-01T00:00:00Z\"}'); PRAGMA user_version=2;").unwrap();
    }
    let store = Store::open(path, "device".into(), "now".into()).unwrap();
    assert_eq!(store.backup_bytes("bak").unwrap(), Some(vec![1]));
    let left: i64 = store
        .db()
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='backups'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(left, 0);
    assert!(std::path::Path::new(&backups_path(path)).exists());
}

#[test]
fn newer_database_is_refused_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    {
        let db = Connection::open(&path).unwrap();
        db.execute_batch("PRAGMA user_version=99;").unwrap();
    }
    let err = Store::open(path.to_str().unwrap(), "d".into(), "n".into())
        .err()
        .unwrap();
    assert_eq!(err.kind, crate::error::Kind::TooNew);
}

#[test]
fn receipts_are_pruned_but_recent_retries_still_resolve() {
    let mut store = memory();
    for i in 0..(RECEIPTS_KEPT as u64 + PRUNE_EVERY * 2) {
        store
            .execute(
                format!("c{i}"),
                1,
                note(&format!("n{i}")),
                "now".into(),
                "today".into(),
            )
            .unwrap();
    }
    let count: i64 = store
        .db()
        .query_row("SELECT COUNT(*) FROM receipts", [], |r| r.get(0))
        .unwrap();
    assert!(count <= RECEIPTS_KEPT + PRUNE_EVERY as i64 + 1, "{count}");
    let last = RECEIPTS_KEPT as u64 + PRUNE_EVERY * 2 - 1;
    assert!(store.receipt(&format!("c{last}")).unwrap().is_some());
}

/// Release timings at 100k sets: `cargo test -p lift-native --release --lib
/// perf_100k -- --ignored --nocapture`.
#[test]
#[ignore]
fn perf_100k() {
    use lift_domain::model::*;
    use std::time::Instant;
    let mut s = Snapshot::empty("d".into(), "now".into());
    let day = |i: i64| {
        lift_domain::prs::iso_from_ms((20_000 + i) * 86_400_000).unwrap()[..10].to_string()
    };
    for i in 0..10_000u64 {
        let date = day(i as i64);
        s.workouts.push(WorkoutRow {
            id: 100 + i,
            date: date.clone(),
            status: "done".into(),
            created_at: format!("{date}T08:00:00.000Z"),
            ..Default::default()
        });
        s.workout_exercises.push(WorkoutExerciseRow {
            id: 100_000 + i,
            workout_id: 100 + i,
            exercise_id: 1 + i % 10,
            ..Default::default()
        });
        for j in 0..10u64 {
            s.sets.push(SetRow {
                id: 1_000_000 + i * 10 + j,
                workout_exercise_id: 100_000 + i,
                weight: Some((40 + i % 80) as f64),
                reps: Some((5 + j) as f64),
                order: j as i64,
                created_at: format!("{date}T08:00:00.000Z"),
                ..Default::default()
            });
        }
    }
    lift_domain::prs::recompute(&mut s, None);
    let t = Instant::now();
    let fast = lift_codec::encode_snapshot(&s, "now").unwrap();
    println!(
        "encode level {}: {:?}, {} bytes",
        lift_codec::GZIP_LEVEL,
        t.elapsed(),
        fast.len()
    );
    for level in [1u32, 3, 6, 9] {
        let t = Instant::now();
        let mut g = flate2::write::GzEncoder::new(vec![], flate2::Compression::new(level));
        let mut w = std::io::BufWriter::with_capacity(64 * 1024, &mut g);
        serde_json::to_writer(&mut w, &s).unwrap();
        drop(w);
        let out = g.finish().unwrap();
        println!("  level {level}: {:?}, {} bytes", t.elapsed(), out.len());
    }
    let t = Instant::now();
    let (decoded, _) = lift_codec::decode_snapshot(&fast, 1 << 30).unwrap();
    println!("decode (typed fast path): {:?}", t.elapsed());
    assert_eq!(decoded, s);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("engine.sqlite");
    crate::migration::install(&path, s, "d", "now", None, None).unwrap();
    let t = Instant::now();
    let mut store = Store::open(path.to_str().unwrap(), "d".into(), "now".into()).unwrap();
    println!("native open: {:?}", t.elapsed());
    let mut samples = vec![];
    for k in 0..20 {
        let t = Instant::now();
        store
            .execute(
                format!("add{k}"),
                store.engine.generation,
                Command::AddSet {
                    we_id: 100_000 + 9_999,
                    input: json!({"weight":200.0,"reps":5.0}),
                },
                "now".into(),
                "today".into(),
            )
            .unwrap();
        samples.push(t.elapsed());
    }
    samples.sort();
    println!(
        "addSet commit (median of 20, incl. fsync): {:?}",
        samples[10]
    );
    let mut samples = vec![];
    for k in 0..20 {
        let t = Instant::now();
        let p = store
            .engine
            .prepare(
                format!("p{k}"),
                Command::AddSet {
                    we_id: 100_000 + 9_999,
                    input: json!({"weight":200.0,"reps":5.0}),
                },
                "now".into(),
                "today".into(),
            )
            .unwrap();
        let _ = lift_engine::row_changes(&p).len();
        samples.push(t.elapsed());
    }
    samples.sort();
    println!("addSet prepare+diff (median): {:?}", samples[10]);
}

#[test]
fn duplicate_gym_names_are_dropped_on_open_and_stay_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    let path = path.to_str().unwrap();
    {
        let mut s = Store::open(path, "d".into(), "now".into()).unwrap();
        s.execute(
            "g".into(),
            1,
            Command::CreateGym {
                name: "Golds".into(),
            },
            "now".into(),
            "today".into(),
        )
        .unwrap();
        // An earlier build stored the same name twice.
        s.db()
            .execute(
                "INSERT INTO records(kind,key,value,ordinal) VALUES('gyms','9',?,99)",
                [crate::rows::encode(&GymRow {
                    id: 9,
                    name: "Golds".into(),
                })],
            )
            .unwrap();
    }
    let s = Store::open(path, "d".into(), "now".into()).unwrap();
    assert_eq!(s.engine.snapshot().gyms.len(), 1);
    assert_eq!(s.engine.revision, 1);
    let left: i64 = s
        .db()
        .query_row("SELECT COUNT(*) FROM records WHERE kind='gyms'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(left, 1);
}

/// Rewrites a current database in the JSON-row format of version `v` (2 or
/// 3), as those builds wrote it.
fn downgrade_to_json(path: &str, v: i64) {
    let db = Connection::open(path).unwrap();
    let rows: Vec<(i64, String, Vec<u8>)> = {
        let mut stmt = db
            .prepare("SELECT rowid, kind, value FROM records")
            .unwrap();
        let r = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        r
    };
    for (rowid, kind, bytes) in rows {
        use crate::rows::decode;
        let json = match kind.as_str() {
            "exercises" => serde_json::to_string(&decode::<ExerciseRow>(&bytes).unwrap()),
            "workouts" => serde_json::to_string(&decode::<WorkoutRow>(&bytes).unwrap()),
            "workout_exercises" => {
                serde_json::to_string(&decode::<WorkoutExerciseRow>(&bytes).unwrap())
            }
            "sets" => serde_json::to_string(&decode::<SetRow>(&bytes).unwrap()),
            "gyms" => serde_json::to_string(&decode::<GymRow>(&bytes).unwrap()),
            _ => serde_json::to_string(&decode::<DayNoteRow>(&bytes).unwrap()),
        }
        .unwrap();
        db.execute(
            "UPDATE records SET value=? WHERE rowid=?",
            rusqlite::params![json, rowid],
        )
        .unwrap();
    }
    if v == 2 {
        db.execute_batch("CREATE TABLE backups (slot TEXT PRIMARY KEY, bytes BLOB NOT NULL, metadata TEXT NOT NULL); INSERT INTO backups VALUES('bak', x'01', '{}');").unwrap();
    }
    db.execute_batch(&format!("PRAGMA user_version={v};"))
        .unwrap();
}
fn populated(path: &str) -> Snapshot {
    let mut store = Store::open(path, "device".into(), "now".into()).unwrap();
    let mut n = 0;
    let mut run = |store: &mut Store, c: Command| {
        n += 1;
        store
            .execute(
                format!("u{n}"),
                store.engine.generation,
                c,
                "2026-01-01T00:00:00Z".into(),
                "2026-01-10".into(),
            )
            .unwrap()
    };
    for day in 1..=5 {
        let r = run(
            &mut store,
            Command::LogSet {
                date: format!("2026-01-0{day}"),
                exercise_id: 1 + day % 2,
                input: json!({"weight":102.05812 + day as f64 * 0.1,"reps":5,"note":"ünï"}),
            },
        );
        let we = r.result["we_id"].as_u64().unwrap();
        run(
            &mut store,
            Command::AddSet {
                we_id: we,
                input: json!({"weight":null,"reps":null,"distance_m":1609.344,"time_seconds":0.30000000000000004}),
            },
        );
    }
    run(
        &mut store,
        Command::CreateGym {
            name: "Golds".into(),
        },
    );
    run(&mut store, note("day"));
    run(&mut store, Command::DeleteExercise { id: 1 });
    let id = store.engine.snapshot().sets[3].id;
    run(&mut store, Command::DeleteSets { ids: vec![id] });
    store.engine.snapshot().clone()
}
type SetBits = (u64, Option<u64>, Option<u64>, Option<u64>);
fn bits(s: &Snapshot) -> Vec<SetBits> {
    s.sets
        .iter()
        .map(|x| {
            (
                x.id,
                x.weight.map(f64::to_bits),
                x.distance_m.map(f64::to_bits),
                x.time_seconds.map(f64::to_bits),
            )
        })
        .collect()
}

#[test]
fn json_databases_upgrade_in_place_and_reopen_identical() {
    for v in [2, 3] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.sqlite");
        let path = path.to_str().unwrap();
        let before = populated(path);
        let sync_before = Store::open(path, "device".into(), "now".into())
            .unwrap()
            .sync_state
            .clone();
        downgrade_to_json(path, v);
        let store = Store::open(path, "device".into(), "now".into()).unwrap();
        assert_eq!(store.engine.snapshot(), &before, "v{v}");
        assert_eq!(bits(store.engine.snapshot()), bits(&before));
        assert_eq!(store.engine.revision, 14);
        assert_eq!(store.sync_state, sync_before);
        assert!(store.receipt("u1").unwrap().is_some());
        let version: i64 = store
            .db()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, DB_VERSION);
        if v == 2 {
            assert_eq!(store.backup_bytes("bak").unwrap(), Some(vec![1]));
        }
        drop(store);
        let again = Store::open(path, "device".into(), "now".into()).unwrap();
        assert_eq!(again.engine.snapshot(), &before);
        assert_eq!(
            again.engine.snapshot().exercises[0].is_deleted,
            before.exercises[0].is_deleted
        );
    }
}

#[test]
fn an_interrupted_upgrade_leaves_the_old_database_intact() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    let path = path.to_str().unwrap();
    let before = populated(path);
    downgrade_to_json(path, 2);
    let image = |p: &str| {
        let db = Connection::open(p).unwrap();
        let mut stmt = db
            .prepare("SELECT kind, key, value, ordinal FROM records ORDER BY kind, key")
            .unwrap();
        let rows: Vec<(String, String, String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let v: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        (rows, v)
    };
    let old = image(path);
    {
        // Fail on the last row the upgrade rewrites.
        let db = Connection::open(path).unwrap();
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
            .unwrap();
        db.execute_batch(&format!("CREATE TRIGGER fail_upgrade BEFORE UPDATE ON records WHEN (SELECT COUNT(*) FROM records WHERE typeof(value)='blob') >= {} BEGIN SELECT RAISE(ABORT,'interrupted'); END;", n - 1)).unwrap();
    }
    let err = Store::open(path, "device".into(), "now".into())
        .err()
        .unwrap();
    assert_ne!(err.kind, crate::error::Kind::Corrupt);
    assert_eq!(image(path), old);
    assert_eq!(old.1, 2);
    {
        let db = Connection::open(path).unwrap();
        db.execute_batch("DROP TRIGGER fail_upgrade;").unwrap();
    }
    let store = Store::open(path, "device".into(), "now".into()).unwrap();
    assert_eq!(store.engine.snapshot(), &before);
}

#[test]
fn verified_pr_flags_survive_reopen_for_the_append_path() {
    use std::sync::atomic::Ordering;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite");
    let path = path.to_str().unwrap();
    let before = populated(path);
    let we = before.workout_exercises.iter().last().unwrap().id;
    let mut store = Store::open(path, "device".into(), "now".into()).unwrap();
    let hits = lift_domain::prs::APPEND_FAST_PATH.load(Ordering::Relaxed);
    store
        .execute(
            "late".into(),
            1,
            Command::AddSet {
                we_id: we,
                input: json!({"weight":300.0,"reps":5}),
            },
            "2026-01-05T23:00:00Z".into(),
            "2026-01-10".into(),
        )
        .unwrap();
    assert!(lift_domain::prs::APPEND_FAST_PATH.load(Ordering::Relaxed) > hits);
    let mut full = store.engine.snapshot().clone();
    lift_domain::prs::recompute(&mut full, None);
    assert_eq!(&full, store.engine.snapshot());
}
