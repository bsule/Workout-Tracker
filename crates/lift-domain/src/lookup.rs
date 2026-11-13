//! Index-backed row lookups for a change being prepared on a copy of an
//! indexed snapshot. Rows the change appended are found by scanning the tail
//! past the indexed length; positions below it stay valid until a row is
//! removed, after which the affected table falls back to a scan.
use crate::{model::Snapshot, queries::Indexes, table::Table};
use std::{cell::RefCell, collections::HashSet};

#[derive(Clone, Copy)]
struct Mark {
    len: usize,
    lineage: u64,
    removals: u64,
}
impl Mark {
    fn of<T>(t: &Table<T>) -> Self {
        Self {
            len: t.len(),
            lineage: t.lineage(),
            removals: t.removals(),
        }
    }
    fn valid<T>(&self, t: &Table<T>) -> bool {
        t.lineage() == self.lineage && t.removals() == self.removals && t.len() >= self.len
    }
}

/// Exercises whose stored PR flags are known to equal a full recompute,
/// because a full pass ran over them in this session. Only these may take
/// the incremental append path: flags loaded from disk or a cloud copy are
/// not trusted to be derived.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Verified {
    pub all: bool,
    pub exercises: HashSet<u64>,
}
impl Verified {
    /// Bumped whenever the PR rules change, so verification recorded under
    /// older rules is not trusted.
    pub const RULES: u32 = 1;
    pub fn contains(&self, exercise: u64) -> bool {
        self.all || self.exercises.contains(&exercise)
    }
    pub fn absorb(&mut self, other: &Verified) {
        self.all |= other.all;
        self.exercises.extend(other.exercises.iter().copied());
    }
}

pub struct Lookup<'a> {
    ix: &'a Indexes,
    exercises: Mark,
    workouts: Mark,
    wes: Mark,
    sets: Mark,
    verified: Option<&'a Verified>,
    newly: RefCell<Verified>,
}
impl<'a> Lookup<'a> {
    /// `ix` must have been built for `snap`.
    pub fn new(ix: &'a Indexes, snap: &Snapshot) -> Self {
        Self {
            ix,
            exercises: Mark::of(&snap.exercises),
            workouts: Mark::of(&snap.workouts),
            wes: Mark::of(&snap.workout_exercises),
            sets: Mark::of(&snap.sets),
            verified: None,
            newly: RefCell::default(),
        }
    }
    /// As `new`, knowing which exercises' flags are verified in `snap`.
    pub fn with_verified(ix: &'a Indexes, snap: &Snapshot, verified: &'a Verified) -> Self {
        Self {
            verified: Some(verified),
            ..Self::new(ix, snap)
        }
    }
    pub fn is_verified(&self, exercise: u64) -> bool {
        self.verified.is_some_and(|v| v.contains(exercise))
            || self.newly.borrow().contains(exercise)
    }
    pub(crate) fn mark_verified(&self, exercises: impl IntoIterator<Item = u64>) {
        self.newly.borrow_mut().exercises.extend(exercises);
    }
    pub(crate) fn mark_all_verified(&self) {
        self.newly.borrow_mut().all = true;
    }
    /// Exercises a full pass verified while preparing this change.
    pub fn take_verified(&self) -> Verified {
        std::mem::take(&mut *self.newly.borrow_mut())
    }
    pub fn base_sets_len(&self) -> usize {
        self.sets.len
    }
    /// Whether every indexed position still holds the row it was indexed for.
    pub fn current(&self, s: &Snapshot) -> bool {
        self.exercises.valid(&s.exercises)
            && self.workouts.valid(&s.workouts)
            && self.wes.valid(&s.workout_exercises)
            && self.sets.valid(&s.sets)
    }
    pub fn exercise_pos(&self, s: &Snapshot, id: u64) -> Option<usize> {
        let t = &s.exercises;
        if self.exercises.valid(t) {
            if let Some(i) = self.ix.exercises.get(&id) {
                return Some(*i);
            }
            return (self.exercises.len..t.len()).find(|i| t[*i].id == id);
        }
        t.position(|e| e.id == id)
    }
    pub fn workout_pos(&self, s: &Snapshot, id: u64) -> Option<usize> {
        let t = &s.workouts;
        if self.workouts.valid(t) {
            if let Some(i) = self.ix.workouts.get(&id) {
                return Some(*i);
            }
            return (self.workouts.len..t.len()).find(|i| t[*i].id == id);
        }
        t.position(|w| w.id == id)
    }
    /// The first workout on `date`, as `workouts.find(...)`.
    pub fn workout_by_date(&self, s: &Snapshot, date: &str) -> Option<usize> {
        let t = &s.workouts;
        if self.workouts.valid(t) {
            if let Some(i) = self.ix.first_dates.get(date) {
                return Some(*i);
            }
            return (self.workouts.len..t.len()).find(|i| t[*i].date == date);
        }
        t.position(|w| w.date == date)
    }
    pub fn we_pos(&self, s: &Snapshot, id: u64) -> Option<usize> {
        let t = &s.workout_exercises;
        if self.wes.valid(t) {
            if let Some(i) = self.ix.we_by_id.get(&id) {
                return Some(*i);
            }
            return (self.wes.len..t.len()).find(|i| t[*i].id == id);
        }
        t.position(|w| w.id == id)
    }
    /// A workout's exercises in position order.
    pub fn wes_of_workout(&self, s: &Snapshot, workout: u64) -> Vec<usize> {
        let t = &s.workout_exercises;
        let mut out: Vec<usize> = if self.wes.valid(t) {
            let mut v = self.ix.wes.get(&workout).cloned().unwrap_or_default();
            v.extend((self.wes.len..t.len()).filter(|i| t[*i].workout_id == workout));
            v
        } else {
            (0..t.len())
                .filter(|i| t[*i].workout_id == workout)
                .collect()
        };
        out.sort_unstable();
        out
    }
    /// An exercise's workout_exercise rows in position order.
    pub fn wes_of_exercise(&self, s: &Snapshot, exercise: u64) -> Vec<usize> {
        let t = &s.workout_exercises;
        let mut out: Vec<usize> = if self.wes.valid(t) {
            let mut v = self
                .ix
                .by_exercise
                .get(&exercise)
                .cloned()
                .unwrap_or_default();
            v.extend((self.wes.len..t.len()).filter(|i| t[*i].exercise_id == exercise));
            v
        } else {
            (0..t.len())
                .filter(|i| t[*i].exercise_id == exercise)
                .collect()
        };
        out.sort_unstable();
        out
    }
    pub fn set_pos(&self, s: &Snapshot, id: u64) -> Option<usize> {
        let t = &s.sets;
        if self.sets.valid(t) {
            if let Some(i) = self.ix.set_by_id.get(&id) {
                return Some(*i);
            }
            return (self.sets.len..t.len()).find(|i| t[*i].id == id);
        }
        t.position(|x| x.id == id)
    }
    /// A workout_exercise's sets in position order.
    pub fn sets_of_we(&self, s: &Snapshot, we: u64) -> Vec<usize> {
        let t = &s.sets;
        let mut out: Vec<usize> = if self.sets.valid(t) {
            let mut v = self.ix.sets.get(&we).cloned().unwrap_or_default();
            v.extend((self.sets.len..t.len()).filter(|i| t[*i].workout_exercise_id == we));
            v
        } else {
            (0..t.len())
                .filter(|i| t[*i].workout_exercise_id == we)
                .collect()
        };
        out.sort_unstable();
        out
    }
}
