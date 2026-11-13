use lift_domain::{
    commands::Command,
    model::*,
    prs,
    queries::{self, Indexes, Query},
};
use lift_engine::Engine;
use serde_json::json;

fn fixture() -> Snapshot {
    let mut s = Snapshot::empty("test".into(), "now".into());
    for i in 0..4u64 {
        s.workouts.push(WorkoutRow {
            id: 100 + i,
            date: format!("2026-01-{:02}", i + 1),
            status: "done".into(),
            ..Default::default()
        });
        s.workout_exercises.push(WorkoutExerciseRow {
            id: 200 + i,
            workout_id: 100 + i,
            exercise_id: 1 + i % 2,
            ..Default::default()
        });
        for j in 0..200u64 {
            s.sets.push(SetRow {
                id: 1000 + i * 200 + j,
                workout_exercise_id: 200 + i,
                weight: (j % 13 != 0).then_some((40 + j % 80) as f64),
                reps: Some((1 + j % 12) as f64),
                is_planned: j % 9 == 0,
                order: (j / 2) as i64,
                created_at: "2026-01-01T12:00:00.000Z".into(),
                ..Default::default()
            });
        }
    }
    prs::recompute(&mut s, None);
    s
}
fn assert_queries(engine: &Engine) {
    let snapshot = engine.snapshot();
    let fresh = Indexes::build(snapshot);
    let mut queries = vec![
        Query::Counts,
        Query::Calendar {
            month: "2026-01".into(),
        },
    ];
    for w in &snapshot.workouts {
        queries.push(Query::Workout { id: w.id });
    }
    for exercise_id in 1..=2 {
        queries.push(Query::History {
            exercise_id,
            offset: 0,
            limit: 100,
        });
        queries.push(Query::PredictPr {
            exercise_id,
            we_id: 200,
            weight: 100.0,
            reps: 5.0,
            queued: vec![],
        });
    }
    for query in queries {
        assert_eq!(
            engine.query(query.clone())["data"],
            queries::query(snapshot, &fresh, query)
        );
    }
}

#[test]
fn deletions_match_full_prs_and_fresh_indexes_for_tail_middle_records_and_batches() {
    let base = fixture();
    let planned: Vec<_> = base
        .sets
        .iter()
        .filter(|s| s.is_planned)
        .map(|s| s.id)
        .collect();
    let records: Vec<_> = base
        .sets
        .iter()
        .filter(|s| s.is_pr || s.is_position_pr)
        .map(|s| s.id)
        .collect();
    let cases = [
        vec![1799],
        vec![1000],
        vec![1511, 1512],
        vec![1400],
        vec![1000, 1201, 1799, 1799, 99999],
        planned,
        records,
        base.sets.iter().map(|s| s.id).collect(),
    ];
    for verified in [false, true] {
        for ids in &cases {
            let mut engine = Engine::new(base.clone(), 0, 1, 2000).unwrap();
            if verified {
                let p = engine
                    .prepare(
                        "verify".into(),
                        Command::RecomputePrs,
                        "now".into(),
                        "today".into(),
                    )
                    .unwrap();
                engine.publish(p).unwrap();
            }
            let before = engine.snapshot().clone();
            let p = engine
                .prepare(
                    "delete".into(),
                    Command::DeleteSets { ids: ids.clone() },
                    "now".into(),
                    "today".into(),
                )
                .unwrap();
            // Preparation cannot alter the visible committed snapshot.
            assert_eq!(engine.snapshot(), &before);
            let mut expected = before.clone();
            expected.sets.retain(|s| !ids.contains(&s.id));
            prs::recompute(&mut expected, None);
            assert_eq!(p.snapshot, expected, "verified={verified}, ids={ids:?}");
            if ids == &vec![1799] {
                assert!(p.changes.sets.truncated);
            }
            engine.publish(p).unwrap();
            assert_queries(&engine);
            // Append after the deletion must use the surviving positions.
            let p = engine
                .prepare(
                    "append".into(),
                    Command::AddSet {
                        we_id: 203,
                        input: json!({"weight":150.0,"reps":8.0}),
                    },
                    "now".into(),
                    "today".into(),
                )
                .unwrap();
            engine.publish(p).unwrap();
            let mut expected = engine.snapshot().clone();
            prs::recompute(&mut expected, None);
            assert_eq!(engine.snapshot(), &expected);
            assert_queries(&engine);
        }
    }
}

#[test]
fn deleting_a_planned_set_still_repairs_unverified_loaded_flags() {
    let mut s = fixture();
    for row in s
        .sets
        .iter_mut()
        .filter(|s| s.workout_exercise_id == 200 || s.workout_exercise_id == 202)
    {
        row.is_pr = true;
        row.was_pr = true;
        row.is_position_pr = true;
        row.was_position_pr = true;
    }
    let mut engine = Engine::new(s, 0, 1, 2000).unwrap();
    let p = engine
        .prepare(
            "delete".into(),
            Command::DeleteSets { ids: vec![1000] },
            "now".into(),
            "today".into(),
        )
        .unwrap();
    engine.publish(p).unwrap();
    let mut expected = engine.snapshot().clone();
    prs::recompute(&mut expected, None);
    assert_eq!(engine.snapshot(), &expected);
    assert_queries(&engine);
}
