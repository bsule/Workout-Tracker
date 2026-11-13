//! Current, historical and position PR computation. Pools are grouped once so
//! recomputing all exercises does not repeatedly scan the entire snapshot.
use crate::{model::Snapshot, units::weight_key};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

pub fn timestamp(iso: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(iso)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

#[derive(Clone)]
struct Candidate {
    index: usize,
    id: u64,
    we: u64,
    order: i64,
    weight: f64,
    reps: f64,
    date: String,
    we_order: i64,
    time: i64,
}
impl Candidate {
    fn chronology(&self, other: &Self) -> Ordering {
        (&self.date, self.we_order, self.order, self.time, self.id).cmp(&(
            &other.date,
            other.we_order,
            other.order,
            other.time,
            other.id,
        ))
    }
}
fn compute(pool: &[&Candidate]) -> (HashSet<usize>, HashSet<usize>) {
    let mut sorted = pool.to_vec();
    sorted.sort_by(|a, b| {
        b.weight
            .total_cmp(&a.weight)
            .then_with(|| b.reps.total_cmp(&a.reps))
            .then_with(|| a.chronology(b))
    });
    let mut current = HashSet::new();
    let mut max_reps = f64::NEG_INFINITY;
    for s in &sorted {
        if s.reps > max_reps {
            current.insert(s.index);
        }
        max_reps = max_reps.max(s.reps);
    }
    sorted.sort_by(|a, b| a.chronology(b));
    let mut historical = HashSet::new();
    let mut frontier: Vec<(f64, f64)> = vec![];
    for s in sorted {
        if frontier.iter().any(|(w, r)| *w >= s.weight && *r >= s.reps) {
            continue;
        }
        historical.insert(s.index);
        frontier.retain(|(w, r)| !(s.weight >= *w && s.reps >= *r));
        frontier.push((s.weight, s.reps));
    }
    (current, historical)
}

pub fn recompute(snapshot: &mut Snapshot, exercises: Option<&HashSet<u64>>) {
    let workout_dates: HashMap<_, _> = snapshot.workouts.iter().map(|w| (w.id, &w.date)).collect();
    let wes: HashMap<_, _> = snapshot
        .workout_exercises
        .iter()
        .map(|w| (w.id, w))
        .collect();
    let skip: HashSet<_> = snapshot
        .exercises
        .iter()
        .filter(|e| e.kind != "weight_reps")
        .map(|e| e.id)
        .collect();
    let mut groups: HashMap<u64, Vec<Candidate>> = HashMap::new();
    let mut affected = vec![];
    for (index, s) in snapshot.sets.iter().enumerate() {
        let Some(we) = wes.get(&s.workout_exercise_id) else {
            continue;
        };
        if skip.contains(&we.exercise_id)
            || exercises.is_some_and(|ids| !ids.contains(&we.exercise_id))
        {
            continue;
        }
        affected.push(index);
        if s.is_planned {
            continue;
        }
        let (Some(w), Some(r)) = (s.weight, s.reps) else {
            continue;
        };
        groups.entry(we.exercise_id).or_default().push(Candidate {
            index,
            id: s.id,
            we: we.id,
            order: s.order,
            weight: weight_key(Some(w)),
            reps: r,
            date: workout_dates
                .get(&we.workout_id)
                .map(|s| s.to_string())
                .unwrap_or_default(),
            we_order: we.order,
            time: timestamp(&s.created_at),
        });
    }
    for i in affected {
        let s = &mut snapshot.sets[i];
        s.is_pr = false;
        s.was_pr = false;
        s.is_position_pr = false;
        s.was_position_pr = false;
    }
    for pool in groups.values() {
        let refs: Vec<_> = pool.iter().collect();
        let (current, historical) = compute(&refs);
        for c in pool {
            snapshot.sets[c.index].is_pr = current.contains(&c.index);
            snapshot.sets[c.index].was_pr = historical.contains(&c.index);
        }
        let mut by_we: HashMap<u64, Vec<&Candidate>> = HashMap::new();
        for c in pool {
            by_we.entry(c.we).or_default().push(c);
        }
        let mut positions: HashMap<usize, Vec<&Candidate>> = HashMap::new();
        for sets in by_we.values_mut() {
            sets.sort_by_key(|c| (c.order, c.id));
            for (p, c) in sets.iter().enumerate() {
                positions.entry(p).or_default().push(c);
            }
        }
        for bucket in positions.values() {
            let (current, historical) = compute(bucket);
            for c in bucket {
                snapshot.sets[c.index].is_position_pr = current.contains(&c.index);
                snapshot.sets[c.index].was_position_pr = historical.contains(&c.index);
            }
        }
    }
}
