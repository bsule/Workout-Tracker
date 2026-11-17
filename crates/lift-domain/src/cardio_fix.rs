//! TEMPORARY one-off repair, run by Command::RecomputePrs. Remove this file,
//! its `mod` line in lib.rs and its call in commands.rs once existing data is
//! fixed. The TypeScript twin is packages/core/src/store/cardioFix.ts.
//!
//! Custom cardio exercises made before cardio defaulted to distance_time were
//! stored as weight_reps, so their minutes x level sets took PR stars. This
//! switches them to distance_time and clears the stars on their sets. The PR
//! pass skips non weight_reps exercises, so it would not clear them itself.
use crate::model::Snapshot;
use std::collections::HashSet;

pub fn fix_custom_cardio_kinds(snap: &mut Snapshot) -> usize {
    let ids: HashSet<u64> = snap
        .exercises
        .iter()
        .filter(|e| e.is_custom && e.category == "cardio" && e.kind == "weight_reps")
        .map(|e| e.id)
        .collect();
    if ids.is_empty() {
        return 0;
    }
    snap.exercises
        .update_where(|e| ids.contains(&e.id), |e| e.kind = "distance_time".into());
    let wes: HashSet<u64> = snap
        .workout_exercises
        .iter()
        .filter(|w| ids.contains(&w.exercise_id))
        .map(|w| w.id)
        .collect();
    snap.sets.update_where(
        |s| {
            wes.contains(&s.workout_exercise_id)
                && (s.is_pr || s.was_pr || s.is_position_pr || s.was_position_pr)
        },
        |s| {
            s.is_pr = false;
            s.was_pr = false;
            s.is_position_pr = false;
            s.was_position_pr = false;
        },
    );
    ids.len()
}

#[cfg(test)]
mod tests {
    use crate::commands::{apply_command, Command, Context};
    use crate::model::Snapshot;
    use serde_json::json;

    #[test]
    fn recompute_switches_old_custom_cardio_to_distance_time_and_clears_stars() {
        let mut s = Snapshot::empty("d".into(), "n".into());
        let mut ctx = Context {
            now: "2026-01-02T00:00:00.000Z".into(),
            today: "2026-01-02".into(),
            next_id: 1000,
        };
        let mut run = |s: &mut Snapshot, c: Command| apply_command(s, c, &mut ctx).unwrap();
        // How an older build made it: cardio, but weight_reps.
        let ex = run(
            &mut s,
            Command::CreateExercise {
                name: "Bike".into(),
                category: "cardio".into(),
                kind: Some("weight_reps".into()),
            },
        )["id"]
            .as_u64()
            .unwrap();
        let w = run(
            &mut s,
            Command::CreateWorkout {
                date: "2026-01-01".into(),
            },
        )["row"]["id"]
            .as_u64()
            .unwrap();
        let we = run(
            &mut s,
            Command::AddExercise {
                workout_id: w,
                exercise_id: ex,
            },
        )["id"]
            .as_u64()
            .unwrap();
        for (minutes, level) in [(20.0, 5), (30.0, 5)] {
            run(
                &mut s,
                Command::AddSet {
                    we_id: we,
                    input: json!({"weight": minutes, "reps": level}),
                },
            );
        }
        assert!(s.sets.iter().any(|x| x.is_pr), "the old kind takes stars");

        run(&mut s, Command::RecomputePrs);
        let row = s.exercises.iter().find(|e| e.id == ex).unwrap();
        assert_eq!(row.kind, "distance_time");
        for x in s.sets.iter() {
            assert!(!x.is_pr && !x.was_pr && !x.is_position_pr && !x.was_position_pr);
        }
    }
}
