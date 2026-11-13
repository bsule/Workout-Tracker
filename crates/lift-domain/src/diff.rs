//! Row-level difference between a committed snapshot and a prepared one.
//! Shared chunks are skipped, so the cost follows the rows a change touched.
//! The same result drives durable writes, validation and index maintenance.
use crate::{model::*, queries::Indexes, table::Table};
use std::collections::{HashMap, HashSet};
use std::hash::Hash;

#[derive(Debug, Default, Clone)]
pub struct TableDiff {
    /// Positions in the new table whose row or ordinal must be written.
    pub upserts: Vec<usize>,
    /// Positions among `upserts` whose key the old table did not hold in the
    /// compared region.
    pub inserted: Vec<usize>,
    /// Keys of rows the new table no longer holds.
    pub deletes: Vec<String>,
    /// True when old positions still hold the same rows (no removals).
    pub positional: bool,
}
impl TableDiff {
    pub fn is_empty(&self) -> bool {
        self.upserts.is_empty() && self.deletes.is_empty()
    }
}

#[derive(Debug, Default, Clone)]
pub struct Changes {
    pub exercises: TableDiff,
    pub workouts: TableDiff,
    pub workout_exercises: TableDiff,
    pub sets: TableDiff,
    pub gyms: TableDiff,
    pub day_notes: TableDiff,
}

fn diff_table<T: PartialEq, K: Eq + Hash + ToString>(
    old: &Table<T>,
    new: &Table<T>,
    key_of: impl Fn(&T) -> K,
) -> Result<TableDiff, String> {
    let mut out = TableDiff {
        positional: true,
        ..Default::default()
    };
    if old.shares_storage_with(new) {
        return Ok(out);
    }
    if old.lineage() == new.lineage() && old.removals() == new.removals() && new.len() >= old.len()
    {
        let mut aligned = true;
        'chunks: for c in 0..new.chunk_count() {
            if new.same_chunk(c, old, c) {
                continue;
            }
            let (start, rows) = new.chunk(c);
            for (k, row) in rows.iter().enumerate() {
                let p = start + k;
                match old.get(p) {
                    Some(prev) => {
                        if key_of(prev) != key_of(row) {
                            aligned = false;
                            break 'chunks;
                        }
                        if prev != row || old.ordinal(p) != new.ordinal(p) {
                            out.upserts.push(p);
                        }
                    }
                    None => {
                        out.upserts.push(p);
                        out.inserted.push(p);
                    }
                }
            }
        }
        if aligned {
            return Ok(out);
        }
        out = TableDiff::default();
    }
    out.positional = false;
    let new_ptrs: HashSet<_> = (0..new.chunk_count()).map(|c| new.chunk_ptr(c)).collect();
    let old_ptrs: HashSet<_> = (0..old.chunk_count()).map(|c| old.chunk_ptr(c)).collect();
    let mut old_rows: HashMap<K, usize> = HashMap::new();
    for c in 0..old.chunk_count() {
        if new_ptrs.contains(&old.chunk_ptr(c)) {
            continue;
        }
        let (start, rows) = old.chunk(c);
        for (k, row) in rows.iter().enumerate() {
            old_rows.insert(key_of(row), start + k);
        }
    }
    let mut seen = HashSet::new();
    for c in 0..new.chunk_count() {
        if old_ptrs.contains(&new.chunk_ptr(c)) {
            continue;
        }
        let (start, rows) = new.chunk(c);
        for (k, row) in rows.iter().enumerate() {
            let p = start + k;
            let key = key_of(row);
            match old_rows.get(&key) {
                Some(&op) => {
                    if &old[op] != row || old.ordinal(op) != new.ordinal(p) {
                        out.upserts.push(p);
                    }
                }
                None => {
                    out.upserts.push(p);
                    out.inserted.push(p);
                }
            }
            if !seen.insert(key) {
                return Err("Duplicate or unsafe record ID".into());
            }
        }
    }
    for (key, _) in old_rows {
        if !seen.contains(&key) {
            out.deletes.push(key.to_string());
        }
    }
    out.deletes.sort();
    Ok(out)
}

pub fn diff(old: &Snapshot, new: &Snapshot) -> Result<Changes, String> {
    Ok(Changes {
        exercises: diff_table(&old.exercises, &new.exercises, |r| r.id)?,
        workouts: diff_table(&old.workouts, &new.workouts, |r| r.id)?,
        workout_exercises: diff_table(&old.workout_exercises, &new.workout_exercises, |r| r.id)?,
        sets: diff_table(&old.sets, &new.sets, |r| r.id)?,
        gyms: diff_table(&old.gyms, &new.gyms, |r| r.id)?,
        day_notes: diff_table(&old.day_notes, &new.day_notes, |r| r.date.clone())?,
    })
}

const MAX_SAFE: u64 = 9_007_199_254_740_991;

fn check_inserted<T>(
    new: &Table<T>,
    d: &TableDiff,
    id: impl Fn(&T) -> u64,
    existed: impl Fn(&u64) -> bool,
) -> Result<(), String> {
    // An inserted key the old table already held lives in a chunk both
    // tables share (otherwise the diff would have matched it), so the new
    // table would hold it twice.
    let mut seen = HashSet::new();
    for &p in &d.inserted {
        let key = id(&new[p]);
        if existed(&key) || !seen.insert(key) {
            return Err("Duplicate or unsafe record ID".into());
        }
    }
    Ok(())
}

/// Validates only the rows `changes` names. `old` must be a validated,
/// committed snapshot and `ix` its indexes.
pub fn validate_changes(
    _old: &Snapshot,
    ix: &Indexes,
    new: &Snapshot,
    changes: &Changes,
) -> Result<(), String> {
    if new.schema_version > SCHEMA_VERSION {
        return Err("Unsupported snapshot schema".into());
    }
    if !new.settings.is_object() {
        return Err("Invalid settings object".into());
    }
    fn ids<T>(t: &Table<T>, d: &TableDiff, id: impl Fn(&T) -> u64) -> Result<(), String> {
        if d.upserts.iter().any(|p| id(&t[*p]) > MAX_SAFE) {
            return Err("Duplicate or unsafe record ID".into());
        }
        Ok(())
    }
    ids(&new.exercises, &changes.exercises, |r| r.id)?;
    ids(&new.workouts, &changes.workouts, |r| r.id)?;
    ids(&new.workout_exercises, &changes.workout_exercises, |r| r.id)?;
    ids(&new.sets, &changes.sets, |r| r.id)?;
    ids(&new.gyms, &changes.gyms, |r| r.id)?;
    for &p in &changes.sets.upserts {
        let s = &new.sets[p];
        if [s.weight, s.reps, s.distance_m, s.time_seconds]
            .into_iter()
            .flatten()
            .any(|v| !v.is_finite())
        {
            return Err("Non-finite set value".into());
        }
    }
    check_inserted(
        &new.exercises,
        &changes.exercises,
        |r| r.id,
        |k| ix.exercises.contains_key(k),
    )?;
    check_inserted(
        &new.workouts,
        &changes.workouts,
        |r| r.id,
        |k| ix.workouts.contains_key(k),
    )?;
    check_inserted(
        &new.workout_exercises,
        &changes.workout_exercises,
        |r| r.id,
        |k| ix.we_by_id.contains_key(k),
    )?;
    check_inserted(
        &new.sets,
        &changes.sets,
        |r| r.id,
        |k| ix.set_by_id.contains_key(k),
    )?;
    if !changes.gyms.is_empty() {
        let mut seen = HashSet::new();
        if new.gyms.iter().any(|g| !seen.insert(g.id)) {
            return Err("Duplicate or unsafe record ID".into());
        }
    }
    if !changes.day_notes.is_empty() {
        let mut seen = HashSet::new();
        if new.day_notes.iter().any(|n| !seen.insert(n.date.as_str())) {
            return Err("Duplicate day note date".into());
        }
    }
    Ok(())
}
