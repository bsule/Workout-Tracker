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

#[test]
fn csv_merge_reimport_adds_nothing_and_new_sets_go_after_existing_ones() {
    let csv = "Date,Exercise,Category,Weight (kg),Weight (lbs),Reps,Kind\n\
        2026-01-01,Zercher Squat,Legs,100,,5,wr\n\
        2026-01-01,Zercher Squat,Legs,100,,5,wr\n\
        2026-01-01,Spoto Press,Chest,,135,8,wr\n";
    let mut s = Snapshot::empty("d".into(), "n".into());
    let first = lift_codec::fitnotes::import(&mut s, csv, false, &mut ctx(100)).unwrap();
    assert_eq!(first["imported"], 3);
    let before = s.clone();
    let second = lift_codec::fitnotes::import(&mut s, csv, false, &mut ctx(1000)).unwrap();
    assert_eq!(second["imported"], 0);
    assert_eq!(s.sets.len(), before.sets.len());
    // One more 100 x 5 than the device has: only the extra one is added,
    // after the sets already there.
    let more = format!("{csv}2026-01-01,Zercher Squat,Legs,100,,5,wr\n");
    let third = lift_codec::fitnotes::import(&mut s, &more, false, &mut ctx(2000)).unwrap();
    assert_eq!(third["imported"], 1);
    let squat_we = s
        .sets
        .iter()
        .find(|x| x.id >= 2000)
        .unwrap()
        .workout_exercise_id;
    let mut orders: Vec<_> = s
        .sets
        .iter()
        .filter(|x| x.workout_exercise_id == squat_we)
        .map(|x| x.order)
        .collect();
    orders.sort();
    assert_eq!(orders, vec![0, 1, 2]);
}

#[test]
fn csv_replace_clears_day_notes() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    s.day_notes.push(lift_domain::model::DayNoteRow {
        date: "2025-12-01".into(),
        text: "old".into(),
    });
    let csv = "Date,Exercise,Category,Weight (kg),Reps\n2026-01-01,Bench Press,Chest,100,5\n";
    lift_codec::fitnotes::import(&mut s, csv, false, &mut ctx(100)).unwrap();
    assert_eq!(s.day_notes.len(), 1, "merge keeps them");
    lift_codec::fitnotes::import(&mut s, csv, true, &mut ctx(200)).unwrap();
    assert!(s.day_notes.is_empty());
}

#[test]
fn json_backup_round_trips_planned_work_and_deleted_exercises() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    let file = json!({"version":2,"custom_exercises":[{"name":"Gone","category":"back","kind":"weight_reps","is_deleted":true}],"workouts":[
        {"date":"2026-01-01","status":"planned","exercises":[
            {"exercise":{"name":"Bench Press","kind":"weight_reps"},"sets":[],"planned_sets":[{"weight_kg":80,"reps":5,"order":0}]},
            {"exercise":{"name":"Gone","kind":"weight_reps"},"sets":[{"weight_kg":20,"reps":10,"order":0}]}
        ]}
    ]});
    let result =
        lift_codec::user_import::import(&mut s, &file.to_string(), true, &mut ctx(100)).unwrap();
    assert_eq!(result["imported"], 1);
    assert_eq!(result["exercisesCreated"], json!([]));
    assert_eq!(s.workouts[0].status, "planned");
    let gone = s.exercises.iter().find(|e| e.name == "Gone").unwrap();
    assert_eq!(gone.is_deleted, Some(true));
    let planned: Vec<_> = s.sets.iter().filter(|x| x.is_planned).collect();
    assert_eq!(planned.len(), 1);
    assert!(!planned[0].is_pr);

    let out = lift_codec::export::user_json(&s, "u", "2026-01-02T00:00:00.000Z");
    assert_eq!(out["version"], 2);
    let w = &out["workouts"][0];
    assert_eq!(w["status"], "planned");
    let bench = w["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["exercise"]["name"] == "Bench Press")
        .unwrap();
    // Never in `sets`, which an older importer would log.
    assert_eq!(bench["sets"], json!([]));
    assert_eq!(bench["planned_sets"][0]["weight_kg"].as_f64(), Some(80.0));
    assert_eq!(out["custom_exercises"][0]["is_deleted"], true);

    // Importing the export again adds nothing.
    let before = s.clone();
    lift_codec::user_import::import(&mut s, &out.to_string(), false, &mut ctx(1000)).unwrap();
    assert_eq!(s, before);

    // A live exercise with the deleted one's name stays live.
    let mut live = Snapshot::empty("d".into(), "n".into());
    lift_codec::user_import::import(
        &mut live,
        &json!({"version":2,"custom_exercises":[{"name":"Gone"}],"workouts":[]}).to_string(),
        false,
        &mut ctx(100),
    )
    .unwrap();
    lift_codec::user_import::import(&mut live, &out.to_string(), false, &mut ctx(1000)).unwrap();
    let gones: Vec<_> = live.exercises.iter().filter(|e| e.name == "Gone").collect();
    assert_eq!(gones.len(), 1);
    assert_ne!(gones[0].is_deleted, Some(true));
}

#[test]
fn imported_exercises_with_no_stated_kind_take_the_category_default() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    let csv = "Date,Exercise,Category,Weight (kg),Reps\n2026-01-01,Hill Climber Intervals,Cardio,20,5\n2026-01-01,Zercher Squat,Legs,100,5\n";
    lift_codec::fitnotes::import(&mut s, csv, false, &mut ctx(1)).unwrap();
    let kind = |s: &Snapshot, n: &str| {
        s.exercises
            .iter()
            .find(|e| e.name == n)
            .unwrap()
            .kind
            .clone()
    };
    assert_eq!(kind(&s, "Hill Climber Intervals"), "distance_time");
    assert_eq!(kind(&s, "Zercher Squat"), "weight_reps");

    let mut s = Snapshot::empty("d".into(), "n".into());
    let file = json!({"version":2,"workouts":[],"custom_exercises":[{"name":"Rower","category":"cardio"},{"name":"Sled Push","category":"legs"}]});
    lift_codec::user_import::import(&mut s, &file.to_string(), false, &mut ctx(1)).unwrap();
    assert_eq!(kind(&s, "Rower"), "distance_time");
    assert_eq!(kind(&s, "Sled Push"), "weight_reps");
}
