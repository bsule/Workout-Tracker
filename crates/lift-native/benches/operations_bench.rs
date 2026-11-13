//! Everyday mobile operations on disposable native SQLite datasets.
//! Run in release mode via cargo bench; excludes migration and Expo overhead.
use lift_native::NativeEngine;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::time::Instant;

#[path = "../../lift-engine/benches/engine_bench.rs"]
#[allow(dead_code)]
mod shared;

const NOW: &str = "2026-11-12T12:00:00.000Z";
fn command(engine: &NativeEngine, id: String, value: Value) -> (Value, f64) {
    let input = value.to_string();
    let start = Instant::now();
    let reply = engine
        .execute(id, 1, input, NOW.into(), "2026-11-12".into())
        .unwrap();
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    (serde_json::from_str(&reply).unwrap(), ms)
}
fn main() {
    let mut results = vec![];
    for count in [1_000, 10_000, 100_000, 250_000] {
        let snapshot = shared::make_snapshot(count);
        let last = &snapshot.workout_exercises[snapshot.workout_exercises.len() - 1];
        let we_id = last.id;
        let exercise_id = last.exercise_id;
        let date = snapshot.workouts[snapshot.workouts.len() - 1].date.clone();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("snapshot.bin"),
            lift_codec::encode_snapshot(&snapshot, NOW).unwrap(),
        )
        .unwrap();
        let path = dir
            .path()
            .join("engine.sqlite")
            .to_str()
            .unwrap()
            .to_string();
        let mut engine =
            NativeEngine::open(path.clone(), "bench".into(), NOW.into(), "{}".into()).unwrap();
        // Verify initial flags before measuring the ordinary warm command path.
        command(&engine, "verify".into(), json!({"op":"recompute_prs"}));
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
                "loadExerciseList",
                json!({"kind":"exercises","sort":"name","q":null,"category":null,"limit":500,"today":"2026-11-12"}),
            ),
            (
                "searchExercises",
                json!({"kind":"exercises","sort":"name","q":"Synthetic 1","category":null,"limit":500,"today":"2026-11-12"}),
            ),
            ("loadExercise", json!({"kind":"exercise","id":exercise_id})),
            (
                "loadHistory30Days",
                json!({"kind":"history","exercise_id":exercise_id,"offset":0,"limit":30}),
            ),
            ("loadSettings", json!({"kind":"settings"})),
            ("loadCounts", json!({"kind":"counts"})),
            (
                "predictPr",
                json!({"kind":"predict_pr","exercise_id":exercise_id,"we_id":we_id,"weight":100.0,"reps":5.0,"queued":[]}),
            ),
            (
                "predictPrQueued",
                json!({"kind":"predict_pr","exercise_id":exercise_id,"we_id":we_id,"weight":100.0,"reps":5.0,"queued":[{"weight":100.0,"reps":5.0},{"weight":105.0,"reps":5.0}]}),
            ),
            (
                "loadChart",
                json!({"kind":"chart","exercise_id":exercise_id,"metric":"one_rm","set_index":0,"unit":"lb"}),
            ),
            (
                "loadRecords",
                json!({"kind":"summary","exercise_id":exercise_id,"sort":"weight","set_number":null}),
            ),
        ];
        // One warm-up followed by seven samples for every operation. Every set
        // cycle adds, edits, then removes its own row; dataset size stays fixed.
        for sample in 0..8 {
            let record = |samples: &mut BTreeMap<&str, Vec<f64>>, name, ms| {
                if sample > 0 {
                    samples.entry(name).or_default().push(ms);
                }
            };
            let (receipt, ms) = command(
                &engine,
                format!("add-{sample}"),
                json!({"op":"add_set","we_id":we_id,"input":{"weight":100.0,"reps":5.0}}),
            );
            record(&mut samples, "addSet", ms);
            let id = receipt["result"]["id"].as_u64().unwrap();
            let (_, ms) = command(
                &engine,
                format!("edit-{sample}"),
                json!({"op":"update_set","set_id":id,"patch":{"weight":105.0,"reps":6.0}}),
            );
            record(&mut samples, "editSet", ms);
            let (_, ms) = command(
                &engine,
                format!("delete-{sample}"),
                json!({"op":"delete_sets","ids":[id]}),
            );
            record(&mut samples, "deleteSet", ms);
            let (_, ms) = command(
                &engine,
                format!("recompute-{sample}"),
                json!({"op":"recompute_prs"}),
            );
            record(&mut samples, "recomputeAllPrs", ms);
            for (name, query) in &queries {
                let input = query.to_string();
                let start = Instant::now();
                let reply = engine.query(input).unwrap();
                let ms = start.elapsed().as_secs_f64() * 1000.0;
                std::hint::black_box(reply);
                record(&mut samples, name, ms);
            }
            engine.shutdown().unwrap();
            drop(engine);
            let start = Instant::now();
            engine =
                NativeEngine::open(path.clone(), "bench".into(), NOW.into(), "{}".into()).unwrap();
            record(
                &mut samples,
                "openLocalDatabase",
                start.elapsed().as_secs_f64() * 1000.0,
            );
        }
        engine.shutdown().unwrap();
        println!("\n{count} sets (10 exercises; median of 7 samples):");
        for (operation, values) in samples {
            let mut ordered = values.clone();
            ordered.sort_by(f64::total_cmp);
            let median = ordered[ordered.len() / 2];
            println!("  {operation:<24} {median:>9.3} ms");
            results.push(
                json!({"sets":count,"operation":operation,"samplesMs":values,"medianMs":median}),
            );
        }
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/local");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("rust-operations-results.json"),
        serde_json::to_string_pretty(
            &json!({"kind":"desktop-native-operations","results":results}),
        )
        .unwrap(),
    )
    .unwrap();
}
