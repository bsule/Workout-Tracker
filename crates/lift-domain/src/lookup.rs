//! Index-backed row lookups for a change being prepared on a copy of an
//! indexed snapshot. Rows the change appended are found by scanning the tail
//! past the indexed length; positions below it stay valid until a row is
//! removed, after which the affected table falls back to a scan.
use crate::{model::Snapshot, queries::Indexes, table::Table};

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

pub struct Lookup<'a> {
    ix: &'a Indexes,
    exercises: Mark,
    workouts: Mark,
    wes: Mark,
    sets: Mark,
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
        }
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
