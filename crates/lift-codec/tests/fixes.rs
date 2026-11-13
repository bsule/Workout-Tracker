//! Regression tests for compatibility fixes in the codec and importers.
use lift_codec::{decode, decode_snapshot, encode, encode_snapshot, migrate};
use lift_domain::{
    commands::{seed_catalog, Context},
    model::{Snapshot, SCHEMA_VERSION},
};
use serde_json::{json, Value};

fn base(version: u64, notes: &str) -> Value {
    json!({
        "schema_version": version, "exported_at": "x", "device_id": "d",
        "settings": {"weight_unit":"lb","first_day_of_week":0},
        "exercises": [], "workout_exercises": [], "sets": [], "gyms": [], "day_notes": [],
        "workouts": [{"id":1,"date":"2026-01-01","status":"done","started_at":null,"finished_at":null,"gym":"","notes":notes,"created_at":"x"}]
    })
}

#[test]
fn session_notes_survive_from_v6_on_and_v5_leftovers_are_blanked() {
    for v in 6..=SCHEMA_VERSION as u64 {
        let (out, migrated) = migrate(base(v, "felt strong")).unwrap();
        assert_eq!(out["workouts"][0]["notes"], "felt strong", "v{v}");
        assert_eq!(migrated, v < SCHEMA_VERSION as u64);
        let typed = decode_snapshot(&encode(&base(v, "felt strong"), "x").unwrap(), 1 << 20)
            .unwrap()
            .0;
        // encode stamps the current version, so this is the current-version
        // fast path; the note must survive it too.
        assert_eq!(typed.workouts[0].notes, "felt strong");
    }
    let (out, migrated) = migrate(base(5, "garbage")).unwrap();
    assert!(migrated);
    assert_eq!(out["workouts"][0]["notes"], "");
    let (out, _) = migrate(base(4, "day note")).unwrap();
    assert_eq!(out["workouts"][0]["notes"], "");
    assert_eq!(out["day_notes"][0]["text"], "day note");
}

#[test]
fn older_snapshots_take_the_migration_path_through_the_fast_decoder() {
    let mut v = base(4, "lifted");
    v["sets"] = json!([{"id":5,"workout_exercise_id":2,"weight":1,"reps":1,"distance_m":null,"distance_unit_display":"","time_seconds":null,"is_planned":false,"is_pr":false,"was_pr":false,"note":"","order":0,"created_at":"x"}]);
    let bytes = {
        use std::io::Write;
        let mut g = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
        g.write_all(v.to_string().as_bytes()).unwrap();
        g.finish().unwrap()
    };
    let (s, migrated) = decode_snapshot(&bytes, 1 << 20).unwrap();
    assert!(migrated);
    assert_eq!(s.day_notes[0].text, "lifted");
    assert!(!s.sets[0].is_position_pr);
    // encode stamps the current version, so a future one is written by hand.
    let mut future = base(10, "");
    future["schema_version"] = json!(SCHEMA_VERSION + 1);
    let raw = future.to_string();
    use std::io::Write;
    let mut g = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
    g.write_all(raw.as_bytes()).unwrap();
    assert!(matches!(
        decode_snapshot(&g.finish().unwrap(), 1 << 20),
        Err(lift_codec::CodecError::TooNew(_))
    ));
}

#[test]
fn typed_encoder_writes_what_the_value_encoder_wrote() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/commands.json")).unwrap();
    let last = f["steps"].as_array().unwrap().last().unwrap()["expected"].clone();
    let snap: Snapshot = serde_json::from_value(last.clone()).unwrap();
    let typed = encode_snapshot(&snap, "2026-05-05T00:00:00.000Z").unwrap();
    let valued = encode(
        &serde_json::to_value(&snap).unwrap(),
        "2026-05-05T00:00:00.000Z",
    )
    .unwrap();
    let a = decode(&typed, 1 << 24).unwrap().0;
    let b = decode(&valued, 1 << 24).unwrap().0;
    assert_eq!(a, b);
    // Key order matches the TypeScript serialize(): {...snap, schema_version, exported_at}.
    let text = {
        use std::io::Read;
        let mut s = String::new();
        flate2::read::GzDecoder::new(&typed[..])
            .read_to_string(&mut s)
            .unwrap();
        s
    };
    assert!(text.starts_with(
        "{\"schema_version\":9,\"exported_at\":\"2026-05-05T00:00:00.000Z\",\"device_id\""
    ));
}

fn ctx(next_id: u64) -> Context {
    Context {
        now: "2026-01-02T00:00:00.000Z".into(),
        today: "2026-01-02".into(),
        next_id,
    }
}

#[test]
fn imported_exercises_never_take_a_built_in_id() {
    let floor = seed_catalog().len() as u64;
    let file = json!({"version":2,"workouts":[{"date":"2026-01-01","exercises":[{"exercise":{"name":"Brand New Lift"},"sets":[{"weight_kg":10,"reps":5}]}]}],"custom_exercises":[{"name":"Another One"}]});
    let mut s = Snapshot::empty("d".into(), "n".into());
    lift_codec::user_import::import(&mut s, &file.to_string(), false, &mut ctx(1)).unwrap();
    for e in &s.exercises {
        assert!(e.id > floor, "{} got {}", e.name, e.id);
    }
    let mut ids: Vec<_> = s.exercises.iter().map(|e| e.id).collect();
    ids.dedup();
    assert_eq!(ids.len(), 2);
    let mut s = Snapshot::empty("d".into(), "n".into());
    let csv = "Date,Exercise,Category,Weight (kg),Reps\n2026-01-01,Brand New Lift,Chest,10,5\n2026-01-01,Other Lift,Chest,10,5\n";
    lift_codec::fitnotes::import(&mut s, csv, false, &mut ctx(1)).unwrap();
    assert!(s.exercises.iter().all(|e| e.id > floor));
    assert_ne!(s.exercises[0].id, s.exercises[1].id);
}

#[test]
fn json_import_reads_values_as_javascript_did() {
    let file = json!({
        "version": "2",
        "workouts": [
            {"date":"2026-01-01","started_at":"","notes":"session","exercises":[
                {"exercise":{"name":"Plank","kind":" time_only "},"sets":[{"time_seconds":60}, false, 0, "", null]}
            ]}
        ]
    });
    let mut s = Snapshot::empty("d".into(), "n".into());
    let result =
        lift_codec::user_import::import(&mut s, &file.to_string(), false, &mut ctx(1000)).unwrap();
    assert_eq!(result["imported"], 1);
    // An empty started_at is falsy: done, and kept as written.
    assert_eq!(s.workouts[0].status, "done");
    assert_eq!(s.workouts[0].started_at.as_deref(), Some(""));
    // "2" >= 2 in JavaScript, so the note is a session note.
    assert_eq!(s.workouts[0].notes, "session");
    assert!(s.day_notes.is_empty());
    // A trimmed time_only kind: the built-in weight × reps Plank does not match.
    let plank = s.exercises.iter().find(|e| e.name == "Plank").unwrap();
    assert_eq!(plank.kind, "time_only");
    assert!(plank.is_custom);
}

#[test]
fn csv_replace_refuses_a_file_with_no_usable_row_but_an_empty_file_still_clears() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    lift_codec::fitnotes::import(
        &mut s,
        "Date,Exercise,Category,Weight (kg),Reps\n2026-01-01,Bench Press,Chest,100,5\n",
        false,
        &mut ctx(100),
    )
    .unwrap();
    let before = s.clone();
    assert!(
        lift_codec::fitnotes::import(&mut s, "Name,Value\nfoo,bar\n", true, &mut ctx(100)).is_err()
    );
    assert_eq!(s, before);
    lift_codec::fitnotes::import(&mut s, "Date,Exercise\n", true, &mut ctx(100)).unwrap();
    assert!(s.sets.is_empty());
}

#[test]
fn a_blob_without_its_tables_is_rejected_rather_than_read_as_empty() {
    use std::io::Write;
    let mut g = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
    g.write_all(br#"{"schema_version":9}"#).unwrap();
    assert!(decode_snapshot(&g.finish().unwrap(), 1 << 20).is_err());
    let mut v = base(9, "");
    v["day_notes"] = Value::Null;
    let s: Snapshot = serde_json::from_value(v).unwrap();
    assert!(s.day_notes.is_empty());
}
