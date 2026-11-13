//! The incremental commit path (index lookups, per-exercise PR passes,
//! chunk-level diffs and index maintenance) against full recomputation.
use lift_domain::{
    commands::Command,
    model::{Snapshot, SCHEMA_VERSION},
    prs,
    queries::{Indexes, Query},
};
use lift_engine::{row_changes, write_set, Engine};
use serde_json::json;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0.wrapping_shl(13);
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0.wrapping_shl(17);
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn pick<T: Copy>(&mut self, v: &[T]) -> Option<T> {
        (!v.is_empty()).then(|| v[self.below(v.len() as u64) as usize])
    }
}

fn flags(s: &Snapshot) -> Vec<(u64, bool, bool, bool, bool)> {
    let mut v: Vec<_> = s
        .sets
        .iter()
        .map(|x| (x.id, x.is_pr, x.was_pr, x.is_position_pr, x.was_position_pr))
        .collect();
    v.sort();
    v
}

fn random_command(rng: &mut Rng, s: &Snapshot) -> Command {
    let sets: Vec<u64> = s.sets.iter().map(|x| x.id).collect();
    let wes: Vec<u64> = s.workout_exercises.iter().map(|x| x.id).collect();
    let workouts: Vec<u64> = s.workouts.iter().map(|x| x.id).collect();
    // Few distinct weights and reps, so ties and equal keys are common.
    let weight = [40.0, 50.0, 50.004, 60.0, 59.999, 70.0][rng.below(6) as usize];
    let reps = (1 + rng.below(6)) as f64;
    // Same-day timestamps collide on purpose to reach the time and id
    // tie-breaks.
    let created = format!("2026-02-0{}T10:00:0{}Z", 1 + rng.below(3), rng.below(3));
    let input =
        json!({"weight":weight,"reps":reps,"created_at":created,"is_planned":rng.below(8)==0});
    match rng.below(12) {
        0..=3 => Command::LogSet {
            date: format!("2026-01-{:02}", 1 + rng.below(20)),
            exercise_id: 1 + rng.below(4),
            input,
        },
        4 | 5 => match rng.pick(&wes) {
            Some(we_id) => Command::AddSet { we_id, input },
            None => Command::CreateWorkout {
                date: "2026-01-01".into(),
            },
        },
        6 => match rng.pick(&sets) {
            Some(set_id) => Command::UpdateSet {
                set_id,
                patch: json!({"weight":weight,"reps":reps}),
            },
            None => Command::RecomputePrs,
        },
        7 => match rng.pick(&sets) {
            Some(set_id) => Command::LogPlannedSet {
                set_id,
                patch: json!({"reps":reps,"created_at":created}),
            },
            None => Command::RecomputePrs,
        },
        8 => Command::DeleteSets {
            ids: (0..1 + rng.below(3))
                .filter_map(|_| rng.pick(&sets))
                .collect(),
        },
        9 => match rng.pick(&wes) {
            Some(we_id) => Command::RemoveExercise { we_id },
            None => Command::RecomputePrs,
        },
        10 => match rng.pick(&workouts) {
            Some(id) => Command::DeleteWorkout { id },
            None => Command::RecomputePrs,
        },
        _ => match (rng.pick(&workouts), rng.pick(&workouts)) {
            (Some(target_id), Some(source_id)) if target_id != source_id => Command::CopyWorkout {
                target_id,
                source_id,
                with_sets: true,
            },
            _ => Command::SetDayNote {
                date: "2026-01-01".into(),
                text: format!("n{}", rng.below(3)),
            },
        },
    }
}

#[test]
fn incremental_prs_indexes_and_writes_match_full_recompute() {
    for seed in 1..=24u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let mut engine = Engine::new(Snapshot::empty("d".into(), "now".into()), 0, 1, 1).unwrap();
        // The durable rows a host would hold, keyed by table and key.
        let mut stored = std::collections::BTreeMap::new();
        for step in 0..200 {
            let command = random_command(&mut rng, engine.snapshot());
            let label = format!("seed {seed} step {step}: {command:?}");
            let Ok(pending) = engine.prepare(
                format!("c{step}"),
                command,
                "2026-02-01T00:00:00Z".into(),
                "2026-01-10".into(),
            ) else {
                continue;
            };
            for change in row_changes(&pending) {
                let key = (change.table, change.key);
                match change.value {
                    Some(v) => {
                        stored.insert(key, (change.ordinal, v.to_value().unwrap()));
                    }
                    None => {
                        stored.remove(&key);
                    }
                }
            }
            write_set(&engine, &pending).unwrap();
            engine.publish(pending).unwrap();
            let s = engine.snapshot();
            let mut full = s.clone();
            prs::recompute(&mut full, None);
            assert_eq!(flags(s), flags(&full), "{label}");
            if step % 7 != 0 && step != 199 {
                continue;
            }
            // Durable rows, read back in ordinal order, are the snapshot.
            for table in ["sets", "workout_exercises", "workouts", "day_notes"] {
                let mut rows: Vec<_> = stored
                    .iter()
                    .filter(|((t, _), _)| *t == table)
                    .map(|(_, (o, v))| (*o, v.clone()))
                    .collect();
                rows.sort_by_key(|(o, _)| *o);
                let rows: Vec<_> = rows.into_iter().map(|(_, v)| v).collect();
                let live = serde_json::to_value(s).unwrap()[table].clone();
                assert_eq!(
                    serde_json::Value::Array(rows),
                    live,
                    "{label} table {table}"
                );
            }
            // Maintained indexes answer like freshly built ones.
            let fresh = Indexes::build(s);
            for w in s.workouts.iter() {
                let q = || Query::Workout { id: w.id };
                assert_eq!(
                    engine.query(q())["data"],
                    lift_domain::queries::query(s, &fresh, q()),
                    "{label}"
                );
            }
            for ex in 1..=4 {
                let q = || Query::History {
                    exercise_id: ex,
                    offset: 0,
                    limit: 100,
                };
                assert_eq!(
                    engine.query(q())["data"],
                    lift_domain::queries::query(s, &fresh, q()),
                    "{label}"
                );
            }
        }
        assert_eq!(engine.snapshot().schema_version, SCHEMA_VERSION);
    }
}

#[test]
fn a_set_save_writes_only_the_rows_it_changes() {
    let mut engine = Engine::new(Snapshot::empty("d".into(), "now".into()), 0, 1, 1).unwrap();
    let mut we = 0;
    for day in 1..=28 {
        for ex in 1..=4 {
            let p = engine
                .prepare(
                    format!("{day}-{ex}"),
                    Command::LogSet {
                        date: format!("2026-01-{day:02}"),
                        exercise_id: ex,
                        input: json!({"weight":50.0,"reps":5.0}),
                    },
                    "2026-02-01T00:00:00Z".into(),
                    "2026-03-01".into(),
                )
                .unwrap();
            we = p.receipt.result["we_id"].as_u64().unwrap();
            engine.publish(p).unwrap();
            for i in 0..20 {
                let p = engine
                    .prepare(
                        format!("{day}-{ex}-{i}"),
                        Command::AddSet {
                            we_id: we,
                            input: json!({"weight":40.0,"reps":3.0}),
                        },
                        "2026-02-01T00:00:00Z".into(),
                        "2026-03-01".into(),
                    )
                    .unwrap();
                engine.publish(p).unwrap();
            }
        }
    }
    let before = engine.snapshot().clone();
    let p = engine
        .prepare(
            "new".into(),
            Command::AddSet {
                we_id: we,
                input: json!({"weight":45.0,"reps":3.0}),
            },
            "2026-02-01T00:00:00Z".into(),
            "2026-03-01".into(),
        )
        .unwrap();
    let changes = row_changes(&p);
    assert!(changes.len() <= 4, "{}", changes.len());
    // Untouched tables and chunks stay shared with the committed snapshot.
    assert!(p.snapshot.workouts.shares_storage_with(&before.workouts));
    assert!(p.snapshot.sets.same_chunk(0, &before.sets, 0));
}
