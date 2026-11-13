//! Separate tail, middle, record and planned deletes on verified snapshots.
use lift_domain::{commands::Command, model::Snapshot, prs};
use lift_engine::Engine;
use serde_json::json;
use std::time::Instant;
#[path = "engine_bench.rs"]
#[allow(dead_code)]
mod shared;

fn main() {
    let mut results = vec![];
    for count in [10_000, 100_000, 250_000] {
        for case in ["tailLogged", "middleLogged", "tailRecord", "tailPlanned"] {
            let mut base = shared::make_snapshot(count);
            let victim = match case {
                "middleLogged" => count / 2,
                _ => count - 1,
            };
            if case == "tailRecord" {
                base.sets[victim].weight = Some(10_000.0);
                base.sets[victim].reps = Some(100.0);
            }
            if case == "tailPlanned" {
                base.sets[victim].is_planned = true;
            }
            let id = base.sets[victim].id;
            let mut times = vec![];
            for sample in 0..8 {
                let mut engine = Engine::new(base.clone(), 0, 1, 1).unwrap();
                let p = engine
                    .prepare(
                        "verify".into(),
                        Command::RecomputePrs,
                        "now".into(),
                        "today".into(),
                    )
                    .unwrap();
                engine.publish(p).unwrap();
                let start = Instant::now();
                let p = engine
                    .prepare(
                        "delete".into(),
                        Command::DeleteSets { ids: vec![id] },
                        "now".into(),
                        "today".into(),
                    )
                    .unwrap();
                engine.publish(p).unwrap();
                let ms = start.elapsed().as_secs_f64() * 1000.0;
                if sample > 0 {
                    times.push(ms);
                }
                // Correctness checks stay outside the timed region.
                let s: &Snapshot = engine.snapshot();
                assert_eq!(s.sets.len(), count - 1);
                let mut expected = s.clone();
                prs::recompute(&mut expected, None);
                assert_eq!(s, &expected);
            }
            let mut sorted = times.clone();
            sorted.sort_by(f64::total_cmp);
            let median = sorted[sorted.len() / 2];
            println!("{count:>7} sets {case:<14} {median:>8.3} ms");
            results.push(json!({"sets":count,"case":case,"samplesMs":times,"medianMs":median}));
        }
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/local");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("rust-deletion-cases.json"),
        serde_json::to_string_pretty(
            &json!({"kind":"desktop-memory-deletion-cases","results":results}),
        )
        .unwrap(),
    )
    .unwrap();
}
