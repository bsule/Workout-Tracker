//! Desktop diagnostic for the durable mobile path: legacy migration, cold open
//! from SQLite, and a set save including its SQLite commit (WAL, synchronous=FULL).
//! Desktop SSD numbers only; phones fsync slower. Run:
//! `cargo bench -p lift-native --bench native_bench`.
use lift_native::NativeEngine;
use serde_json::json;
use std::time::Instant;

#[path = "../../lift-engine/benches/engine_bench.rs"]
#[allow(dead_code)]
mod shared;

const NOW: &str = "2026-11-12T00:00:00.000Z";

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.total_cmp(b));
    v[v.len() / 2]
}

fn main() {
    let mut results = Vec::new();
    for count in [1_000, 10_000, 50_000, 100_000] {
        let snap = shared::make_snapshot(count);
        let legacy = lift_codec::encode_snapshot(&snap, NOW).unwrap();
        let mut migrate = vec![];
        let mut open = vec![];
        let mut add = vec![];
        for sample in 0..4 {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("snapshot.bin"), &legacy).unwrap();
            let db = dir
                .path()
                .join("engine.sqlite")
                .to_str()
                .unwrap()
                .to_string();
            let start = Instant::now();
            let engine =
                NativeEngine::open(db.clone(), "bench".into(), NOW.into(), "{}".into()).unwrap();
            let first = start.elapsed().as_secs_f64() * 1000.0;
            engine.shutdown().unwrap();
            drop(engine);
            let start = Instant::now();
            let engine = NativeEngine::open(db, "bench".into(), NOW.into(), "{}".into()).unwrap();
            let reopen = start.elapsed().as_secs_f64() * 1000.0;
            let opened: serde_json::Value = serde_json::from_str(
                &engine
                    .query(r#"{"kind":"calendar","month":"2000-01"}"#.into())
                    .unwrap(),
            )
            .unwrap();
            let generation = opened["generation"].as_u64().unwrap();
            let mut adds = vec![];
            for i in 0..6 {
                let cmd = json!({"op": "add_set", "we_id": 100_000, "input": {"weight": 100.0, "reps": 5.0}}).to_string();
                let start = Instant::now();
                engine
                    .execute(
                        format!("bench-{sample}-{i}"),
                        generation,
                        cmd,
                        NOW.into(),
                        "2026-11-12".into(),
                    )
                    .unwrap();
                adds.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            engine.shutdown().unwrap();
            if sample > 0 {
                migrate.push(first);
                open.push(reopen);
                add.push(median(adds[1..].to_vec()));
            }
        }
        println!(
            "{:>7} sets  first open + legacy migration {:>8.2} ms   cold open {:>7.2} ms   addSet incl. SQLite commit {:>6.2} ms",
            count, median(migrate.clone()), median(open.clone()), median(add.clone())
        );
        results.push(
            json!({"sets": count, "migrateMs": migrate, "openMs": open, "addSetCommitMs": add}),
        );
    }
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/local");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("rust-native-results.json"),
        serde_json::to_string_pretty(
            &json!({"kind": "desktop-diagnostic-native", "results": results}),
        )
        .unwrap(),
    )
    .unwrap();
}
