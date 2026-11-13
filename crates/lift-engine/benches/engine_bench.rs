//! Desktop diagnostic that mirrors `scripts/engine/baseline.test.ts` operation
//! for operation, so the two JSON outputs compare like for like. Setup (building
//! the engine, cloning inputs) stays outside the timed region. Not a phone or
//! bridge benchmark: see `crates/lift-native/benches/native_bench.rs` for the
//! SQLite commit path. Run: `cargo bench -p lift-engine --bench engine_bench`.
use lift_domain::commands::*;
use lift_domain::model::*;
use lift_domain::queries::*;
use lift_domain::table::Table;
use lift_engine::Engine;
use serde_json::json;
use std::collections::HashSet;
use std::time::Instant;

/// 2000-01-01 plus `i` days: one workout per date, like the TS baseline.
pub fn day(i: usize) -> String {
    let mut y = 2000i64;
    let mut d = i as i64;
    let leap = |y: i64| (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    loop {
        let len = if leap(y) { 366 } else { 365 };
        if d < len {
            break;
        }
        d -= len;
        y += 1;
    }
    let months = [
        31,
        if leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0;
    while d >= months[m] {
        d -= months[m];
        m += 1;
    }
    format!("{:04}-{:02}-{:02}", y, m + 1, d + 1)
}

pub fn make_snapshot(set_count: usize) -> Snapshot {
    let mut snap = Snapshot {
        schema_version: SCHEMA_VERSION,
        exported_at: "2026-11-12T00:00:00.000Z".into(),
        device_id: "bench-device".into(),
        settings: json!({
            "weight_unit": "lb",
            "first_day_of_week": 0,
            "show_position_prs": true,
            "show_rest_time": true,
            "show_time_since_last_set": true,
            "warmup_sets_enabled": false,
            "default_increment": 2.5,
            "rest_timer_seconds": 90,
            "auto_start_timer": true,
        }),
        exercises: (1..=10)
            .map(|i| ExerciseRow {
                id: i,
                name: format!("Synthetic {}", i),
                category: "chest".into(),
                kind: "weight_reps".into(),
                is_custom: true,
                is_deleted: Some(false),
            })
            .collect::<Vec<_>>()
            .into(),
        workouts: Table::default(),
        workout_exercises: Table::default(),
        sets: Table::default(),
        gyms: Table::default(),
        day_notes: Table::default(),
    };

    let workouts_count = set_count / 10;
    let mut workouts = Vec::with_capacity(workouts_count);
    let mut wes = Vec::with_capacity(workouts_count);
    let mut sets = Vec::with_capacity(set_count);

    for i in 0..workouts_count {
        let date = day(i);
        let wid = (100 + i) as u64;
        let weid = (100_000 + i) as u64;
        workouts.push(WorkoutRow {
            id: wid,
            date: date.clone(),
            status: "done".into(),
            started_at: None,
            finished_at: None,
            gym: "".into(),
            notes: "".into(),
            created_at: format!("{}T08:00:00.000Z", date),
        });
        wes.push(WorkoutExerciseRow {
            id: weid,
            workout_id: wid,
            exercise_id: ((i % 10) + 1) as u64,
            order: 0,
            note: "".into(),
        });
        for j in 0..10 {
            sets.push(SetRow {
                id: (1_000_000 + i * 10 + j) as u64,
                workout_exercise_id: weid,
                weight: Some((40 + (i % 80)) as f64),
                reps: Some((5 + j) as f64),
                distance_m: None,
                distance_unit_display: "".into(),
                time_seconds: None,
                is_planned: false,
                is_pr: false,
                was_pr: false,
                is_position_pr: false,
                was_position_pr: false,
                note: "".into(),
                order: j as i64,
                created_at: format!("{}T08:00:00.000Z", date),
            });
        }
    }
    snap.workouts = workouts.into();
    snap.workout_exercises = wes.into();
    snap.sets = sets.into();
    snap
}

const NOW: &str = "2026-11-12T00:00:00.000Z";
const TODAY: &str = "2026-11-12";

fn main() {
    let mut results = Vec::new();
    for count in [1_000, 10_000, 50_000, 100_000] {
        let snap = make_snapshot(count);
        let bytes = lift_codec::encode_snapshot(&snap, NOW).unwrap();
        for operation in [
            "cloneAndHydrateIndexes",
            "prExercise",
            "history",
            "addSet",
            "serialize",
            "parse",
        ] {
            let mut samples_ms = Vec::new();
            for sample in 0..6 {
                // Untimed setup, the equivalent of the baseline's setSnapshot(structuredClone(snap)).
                let mut engine = Engine::new(snap.clone(), 1, 1, 1).unwrap();
                let mut pr_input = snap.clone();
                let one: HashSet<u64> = [1].into_iter().collect();
                let start = Instant::now();
                match operation {
                    // Load an in-memory snapshot into a ready engine (validate + indexes).
                    "cloneAndHydrateIndexes" => {
                        std::hint::black_box(Engine::new(snap.clone(), 1, 1, 1).unwrap());
                    }
                    // Full PR recompute for one exercise (baseline: recomputePrsForExercise).
                    "prExercise" => lift_domain::prs::recompute(&mut pr_input, Some(&one)),
                    // Whole history for one exercise (baseline: getExerciseHistoryQ).
                    "history" => {
                        std::hint::black_box(
                            engine
                                .try_query(Query::History {
                                    exercise_id: 1,
                                    offset: 0,
                                    limit: usize::MAX,
                                })
                                .unwrap(),
                        );
                    }
                    // Everything an in-memory set save does: command, PRs, diff, publish.
                    "addSet" => {
                        let cmd = Command::AddSet {
                            we_id: 100_000,
                            input: json!({"weight": 100.0, "reps": 5.0}),
                        };
                        let prepared = engine
                            .prepare(format!("bench-{sample}"), cmd, NOW.into(), TODAY.into())
                            .unwrap();
                        std::hint::black_box(lift_engine::write_set(&engine, &prepared).unwrap());
                        engine.publish(prepared).unwrap();
                    }
                    // JSON + gzip, what the app writes (baseline: serialize).
                    "serialize" => {
                        std::hint::black_box(lift_codec::encode_snapshot(&snap, NOW).unwrap());
                    }
                    // gunzip + JSON + migrate check (baseline: parse).
                    "parse" => {
                        std::hint::black_box(
                            lift_codec::decode_snapshot(&bytes, 512 << 20).unwrap(),
                        );
                    }
                    _ => unreachable!(),
                }
                let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                if sample > 0 {
                    samples_ms.push(elapsed);
                }
            }
            results.push(json!({"sets": count, "operation": operation, "samplesMs": samples_ms, "snapshotBytes": bytes.len()}));
        }
    }
    let output = json!({"platform": std::env::consts::OS, "arch": std::env::consts::ARCH, "kind": "desktop-diagnostic-rust", "results": results});
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/local");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rust-results.json");
    std::fs::write(&path, serde_json::to_string_pretty(&output).unwrap()).unwrap();
    println!("Saved {}", path.display());
}
