//! Matched in-memory operations; also writes the exact input for TypeScript.
use lift_domain::{commands::Command, queries::Query};
use lift_engine::Engine;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Instant;

#[path = "engine_bench.rs"]
#[allow(dead_code)]
mod shared;
const NOW: &str = "2026-11-12T12:00:00.000Z";
fn command(engine: &mut Engine, id: String, command: Command) -> (Value, f64) {
    let start = Instant::now();
    let pending = engine
        .prepare(id, command, NOW.into(), "2026-11-12".into())
        .unwrap();
    let receipt = engine.publish(pending).unwrap();
    (receipt.result, start.elapsed().as_secs_f64() * 1000.0)
}
fn main() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/local");
    std::fs::create_dir_all(&dir).unwrap();
    let mut results = vec![];
    for count in [1_000, 10_000, 100_000, 250_000] {
        let snapshot = shared::make_snapshot(count);
        let we = &snapshot.workout_exercises[snapshot.workout_exercises.len() - 1];
        let (we_id, exercise_id) = (we.id, we.exercise_id);
        let date = snapshot.workouts[snapshot.workouts.len() - 1].date.clone();
        let mut engine = Engine::new(snapshot, 0, 1, 1).unwrap();
        command(&mut engine, "verify".into(), Command::RecomputePrs);
        // TypeScript reads this exact verified input, not a separate generator.
        std::fs::write(
            dir.join(format!("operations-fixture-{count}.json")),
            serde_json::to_vec(engine.snapshot()).unwrap(),
        )
        .unwrap();
        let mut samples: BTreeMap<&str, Vec<f64>> = BTreeMap::new();
        let queries = [
            (
                "loadWorkoutDay",
                json!({"kind":"workout_by_date","date":date}),
            ),
            (
                "loadCalendarMonth",
                json!({"kind":"calendar","month":&date[..7]}),
            ),
            (
                "predictPr",
                json!({"kind":"predict_pr","exercise_id":exercise_id,"we_id":we_id,"weight":100.0,"reps":5.0,"queued":[]}),
            ),
            (
                "predictPrQueued",
                json!({"kind":"predict_pr","exercise_id":exercise_id,"we_id":we_id,"weight":100.0,"reps":5.0,"queued":[{"weight":100.0,"reps":5.0},{"weight":105.0,"reps":5.0}]}),
            ),
        ];
        let queries: Vec<(&str, Query)> = queries
            .into_iter()
            .map(|(name, q)| (name, serde_json::from_value(q).unwrap()))
            .collect();
        for sample in 0..8 {
            let record = |samples: &mut BTreeMap<&str, Vec<f64>>, name, ms| {
                if sample > 0 {
                    samples.entry(name).or_default().push(ms);
                }
            };
            let (row, ms) = command(
                &mut engine,
                format!("add-{sample}"),
                Command::AddSet {
                    we_id,
                    input: json!({"weight":100.0,"reps":5.0}),
                },
            );
            record(&mut samples, "addSet", ms);
            let id = row["id"].as_u64().unwrap();
            let (_, ms) = command(
                &mut engine,
                format!("edit-{sample}"),
                Command::UpdateSet {
                    set_id: id,
                    patch: json!({"weight":105.0,"reps":6.0}),
                },
            );
            record(&mut samples, "editSet", ms);
            let (_, ms) = command(
                &mut engine,
                format!("delete-{sample}"),
                Command::DeleteSets { ids: vec![id] },
            );
            record(&mut samples, "deleteSet", ms);
            let (_, ms) = command(
                &mut engine,
                format!("recompute-{sample}"),
                Command::RecomputePrs,
            );
            record(&mut samples, "recomputeAllPrs", ms);
            for (name, query) in &queries {
                let start = Instant::now();
                std::hint::black_box(engine.try_query(query.clone()).unwrap());
                record(&mut samples, name, start.elapsed().as_secs_f64() * 1000.0);
            }
        }
        for (operation, values) in samples {
            let mut sorted = values.clone();
            sorted.sort_by(f64::total_cmp);
            let median = sorted[sorted.len() / 2];
            println!("{count:>7} sets {operation:<20} {median:>9.3} ms (in memory)");
            results.push(
                json!({"sets":count,"operation":operation,"samplesMs":values,"medianMs":median}),
            );
        }
    }
    std::fs::write(
        dir.join("rust-memory-operations-results.json"),
        serde_json::to_string_pretty(
            &json!({"kind":"desktop-rust-memory-operations","results":results}),
        )
        .unwrap(),
    )
    .unwrap();
}
