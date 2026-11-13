//! Distribution-sensitive desktop diagnostics, including concurrent captures.
//! Uses disposable databases only. Does not include Expo or phone overhead.
use lift_native::NativeEngine;
use serde_json::{json, Value};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

#[path = "../../lift-engine/benches/engine_bench.rs"]
#[allow(dead_code)]
mod shared;

const NOW: &str = "2026-11-12T12:00:00.000Z";
fn median(samples: &[f64]) -> f64 {
    let mut ordered = samples.to_vec();
    ordered.sort_by(f64::total_cmp);
    ordered[ordered.len() / 2]
}
fn execute(engine: &NativeEngine, id: &str, command: Value) -> f64 {
    let start = Instant::now();
    engine
        .execute(
            id.into(),
            1,
            command.to_string(),
            NOW.into(),
            "2026-11-12".into(),
        )
        .unwrap();
    start.elapsed().as_secs_f64() * 1000.0
}
fn history(engine: &NativeEngine, exercise: u64, full: bool) -> (usize, f64) {
    let start = Instant::now();
    let mut offset = 0;
    loop {
        let reply: Value = serde_json::from_str(
            &engine
                .query(
                    json!({"kind":"history","exercise_id":exercise,"offset":offset,"limit":100})
                        .to_string(),
                )
                .unwrap(),
        )
        .unwrap();
        let page = reply["data"]["items"].as_array().unwrap();
        let total = reply["data"]["total"].as_u64().unwrap() as usize;
        offset += page.len();
        if !full || offset >= total {
            if full {
                assert_eq!(offset, total);
            }
            return (total, start.elapsed().as_secs_f64() * 1000.0);
        }
        assert!(!page.is_empty());
    }
}
fn main() {
    let mut results = vec![];
    for count in [10_000, 100_000, 250_000] {
        for exercises in [10, 1] {
            let mut snapshot = shared::make_snapshot(count);
            if exercises == 1 {
                for i in 0..snapshot.workout_exercises.len() {
                    snapshot.workout_exercises[i].exercise_id = 1;
                }
            }
            let legacy = lift_codec::encode_snapshot(&snapshot, NOW).unwrap();
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("snapshot.bin"), legacy).unwrap();
            let engine = NativeEngine::open(
                dir.path().join("engine.sqlite").to_str().unwrap().into(),
                "bench".into(),
                NOW.into(),
                "{}".into(),
            )
            .unwrap();
            let latest = 100_000 + count / 10 - 1;
            let append =
                || json!({"op":"add_set","we_id":latest,"input":{"weight":100.0,"reps":5.0}});
            // First append verifies loaded flags; subsequent ones may use the
            // incremental path. Keep these separate rather than hide the cost.
            let first_append = execute(&engine, "first", append());
            let appends: Vec<_> = (0..7)
                .map(|i| execute(&engine, &format!("append-{i}"), append()))
                .collect();
            let backdated = execute(
                &engine,
                "backdated",
                json!({"op":"update_set","set_id":1_000_000,"patch":{"weight":101.0}}),
            );
            let (days, first_page) = history(&engine, 1, false);
            let (_, all_history) = history(&engine, 1, true);

            let barrier = Arc::new(Barrier::new(2));
            let capture_engine = engine.clone();
            let started = barrier.clone();
            let capture = std::thread::spawn(move || {
                started.wait();
                let start = Instant::now();
                let upload = capture_engine.prepare_upload(NOW.into()).unwrap();
                (start.elapsed().as_secs_f64() * 1000.0, upload.bytes.len())
            });
            barrier.wait();
            // Let capture take its copy before measuring saves while it encodes.
            std::thread::sleep(Duration::from_millis(2));
            let during: Vec<_> = (0..7)
                .map(|i| execute(&engine, &format!("during-{i}"), append()))
                .collect();
            let (capture_ms, bytes) = capture.join().unwrap();
            engine.shutdown().unwrap();
            println!("{count:>7} sets / {exercises:>2} exercises: first append {first_append:.2} ms, verified append {:.2} ms, backdated edit {backdated:.2} ms, history {days} days {all_history:.2} ms, save during capture {:.2} ms, capture {capture_ms:.2} ms ({bytes} bytes)", median(&appends), median(&during));
            results.push(json!({"sets":count,"exercises":exercises,"firstAppendMs":first_append,"appendMs":appends,"backdatedEditMs":backdated,"historyDays":days,"firstHistoryPageMs":first_page,"allHistoryMs":all_history,"appendDuringCaptureMs":during,"captureMs":capture_ms,"snapshotBytes":bytes}));
        }
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/local");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("rust-stress-results.json"),
        serde_json::to_string_pretty(&json!({"kind":"desktop-native-stress","results":results}))
            .unwrap(),
    )
    .unwrap();
}
