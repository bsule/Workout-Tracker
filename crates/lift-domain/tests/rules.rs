//! Command rules ported from packages/core/src/store/mutations.ts and
//! gymRules.ts.
use lift_domain::{
    commands::{apply_command, Command, Context},
    model::{GymRow, Snapshot},
    queries::{query, Indexes, Query},
};
use serde_json::{json, Value};

fn ctx() -> Context {
    Context {
        now: "2026-01-02T00:00:00.000Z".into(),
        today: "2026-01-02".into(),
        next_id: 1000,
    }
}
fn run(s: &mut Snapshot, c: Command) -> Value {
    apply_command(s, c, &mut ctx()).unwrap()
}

#[test]
fn gym_names_follow_the_saved_spelling_exact_first_and_trimmed() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    s.gyms.push(GymRow {
        id: 1,
        name: "Golds".into(),
    });
    s.gyms.push(GymRow {
        id: 2,
        name: "golds".into(),
    });
    let w = run(
        &mut s,
        Command::CreateWorkout {
            date: "2026-01-01".into(),
        },
    )["row"]["id"]
        .as_u64()
        .unwrap();
    run(
        &mut s,
        Command::PatchWorkout {
            id: w,
            patch: json!({"gym":" golds "}),
        },
    );
    assert_eq!(s.workouts[0].gym, "golds");
    run(
        &mut s,
        Command::PatchWorkout {
            id: w,
            patch: json!({"gym":"  New Place "}),
        },
    );
    assert_eq!(s.workouts[0].gym, "New Place");
    assert_eq!(s.gyms.iter().filter(|g| g.name == "New Place").count(), 1);
    assert_eq!(
        run(
            &mut s,
            Command::CreateGym {
                name: "new place".into()
            }
        )["name"],
        "New Place"
    );
    // A patch without a gym never saves the workout's gym again.
    let gym = s.gyms[2].id;
    run(&mut s, Command::DeleteGym { id: gym });
    run(
        &mut s,
        Command::PatchWorkout {
            id: w,
            patch: json!({"notes":"n"}),
        },
    );
    assert!(s.gyms.iter().all(|g| g.name != "New Place"));
}

#[test]
fn renaming_a_gym_to_its_own_name_changes_nothing() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    s.gyms.push(GymRow {
        id: 1,
        name: "Golds".into(),
    });
    let w = run(
        &mut s,
        Command::CreateWorkout {
            date: "2026-01-01".into(),
        },
    )["row"]["id"]
        .as_u64()
        .unwrap();
    run(
        &mut s,
        Command::PatchWorkout {
            id: w,
            patch: json!({"gym":"Golds"}),
        },
    );
    s.workouts[0].gym = "GOLDS".into();
    let out = run(
        &mut s,
        Command::RenameGym {
            id: 1,
            name: " Golds ".into(),
        },
    );
    assert_eq!(out["name"], "Golds");
    assert_eq!(s.workouts[0].gym, "GOLDS");
    run(
        &mut s,
        Command::RenameGym {
            id: 1,
            name: "Gold's".into(),
        },
    );
    assert_eq!(s.workouts[0].gym, "Gold's");
}

#[test]
fn update_set_cannot_change_planned_state() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    let r = run(
        &mut s,
        Command::LogSet {
            date: "2026-01-01".into(),
            exercise_id: 1,
            input: json!({"weight":100,"reps":5}),
        },
    );
    let id = r["set_id"].as_u64().unwrap();
    run(
        &mut s,
        Command::UpdateSet {
            set_id: id,
            patch: json!({"is_planned":true,"reps":6}),
        },
    );
    assert!(!s.sets[0].is_planned);
    assert_eq!(s.sets[0].reps, Some(6.0));
}

#[test]
fn log_set_reuses_the_days_workout_and_exercise_row() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    let first = run(
        &mut s,
        Command::LogSet {
            date: "2026-01-01".into(),
            exercise_id: 1,
            input: json!({"weight":100,"reps":5,"created_at":"2026-01-01T10:00:00.000Z"}),
        },
    );
    let w = first["workout_id"].as_u64().unwrap();
    run(
        &mut s,
        Command::PatchWorkout {
            id: w,
            patch: json!({"finished_at":"2026-01-01T11:00:00.000Z"}),
        },
    );
    let second = run(
        &mut s,
        Command::LogSet {
            date: "2026-01-01".into(),
            exercise_id: 1,
            input: json!({"weight":100,"reps":6}),
        },
    );
    assert_eq!(second["workout_id"], first["workout_id"]);
    assert_eq!(second["we_id"], first["we_id"]);
    assert_eq!(second["merged_into_finished"], true);
    assert_eq!(second["set"]["order"], 1);
    assert_eq!(s.workouts.len(), 1);
    assert_eq!(s.workout_exercises.len(), 1);
    assert_eq!(first["set"]["created_at"], "2026-01-01T10:00:00.000Z");
    let other = run(
        &mut s,
        Command::LogSet {
            date: "2026-01-01".into(),
            exercise_id: 2,
            input: json!({"weight":50,"reps":5}),
        },
    );
    assert_eq!(other["workout_id"], first["workout_id"]);
    assert_ne!(other["we_id"], first["we_id"]);
}

#[test]
fn exercise_list_is_not_capped() {
    let mut s = Snapshot::empty("d".into(), "n".into());
    for i in 0..700 {
        run(
            &mut s,
            Command::CreateExercise {
                name: format!("Lift {i}"),
                category: "chest".into(),
                kind: None,
            },
        );
    }
    let ix = Indexes::build(&s);
    let q: Query = serde_json::from_value(json!({"kind":"exercises","sort":"name","q":null,"category":null,"limit":500,"today":"2026-01-02"})).unwrap();
    let all = query(&s, &ix, q);
    assert_eq!(
        all.as_array().unwrap().len(),
        700 + lift_domain::commands::seed_catalog().len()
    );
    let mut ids: Vec<_> = s.exercises.iter().map(|e| e.id).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 700);
}

#[test]
fn repair_renumbers_duplicate_ids_and_drops_repeated_names_and_dates() {
    let mut s: Snapshot = serde_json::from_value(json!({
        "schema_version": 9,
        "workouts": [], "workout_exercises": [], "sets": [],
        "exercises": [{"id":63,"name":"A"},{"id":63,"name":"B"}],
        "gyms": [{"id":1,"name":"G"},{"id":2,"name":"G"},{"id":3,"name":"g"}],
        "day_notes": [{"date":"2026-01-01","text":"first"},{"date":"2026-01-01","text":"second"}]
    }))
    .unwrap();
    assert!(lift_domain::model::repair(&mut s));
    assert_eq!(s.exercises[1].id, 63);
    assert_eq!(s.exercises[1].name, "B");
    assert!(s.exercises[0].id > 63);
    assert_eq!(s.gyms.len(), 2);
    assert_eq!(s.day_notes.len(), 1);
    assert_eq!(s.day_notes[0].text, "first");
    lift_domain::model::validate(&s).unwrap();
    assert!(!lift_domain::model::repair(&mut s));
}
