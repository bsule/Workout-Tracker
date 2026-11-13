//! Gym name rules shared by commands, replay and repair, as
//! packages/core/src/store/gymRules.ts and repair.ts.
use crate::model::{GymRow, Snapshot};
use std::collections::HashSet;

/// The saved gym a typed name means: the exact (trimmed) name first, then the
/// same name in another case.
pub fn find_saved_gym<'a>(
    gyms: impl IntoIterator<Item = &'a GymRow> + Clone,
    name: &str,
) -> Option<&'a GymRow> {
    let trimmed = name.trim();
    let lower = trimmed.to_lowercase();
    gyms.clone()
        .into_iter()
        .find(|g| g.name == trimmed)
        .or_else(|| gyms.into_iter().find(|g| g.name.to_lowercase() == lower))
}

/// Renames gym `id` to `new_name` (trimmed, already checked) and rewrites the
/// gym of every workout saved under its old name, including another spelling
/// of it unless that spelling is a separate saved gym. False when missing.
pub fn rename_gym_in(snap: &mut Snapshot, id: u64, new_name: &str) -> bool {
    let Some(idx) = snap.gyms.position(|g| g.id == id) else {
        return false;
    };
    let old_name = snap.gyms[idx].name.clone();
    let others: HashSet<String> = snap
        .gyms
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != idx)
        .map(|(_, g)| g.name.clone())
        .collect();
    snap.gyms[idx].name = new_name.to_string();
    let old_lower = old_name.to_lowercase();
    snap.workouts.update_where(
        |w| w.gym == old_name || (w.gym.to_lowercase() == old_lower && !others.contains(&w.gym)),
        |w| w.gym = new_name.to_string(),
    );
    true
}

/// Repairs on every load: gym rows whose name repeats an earlier row exactly
/// (keeping the first), and repeated day-note dates (keeping the first, the
/// one `getDayNote` showed). True when anything was dropped.
pub fn repair(snap: &mut Snapshot) -> bool {
    let mut changed = false;
    let mut names = HashSet::new();
    if snap.gyms.iter().any(|g| !names.insert(g.name.clone())) {
        let mut seen = HashSet::new();
        snap.gyms.retain(|g| seen.insert(g.name.clone()));
        changed = true;
    }
    let mut dates = HashSet::new();
    if snap.day_notes.iter().any(|n| !dates.insert(n.date.clone())) {
        let mut seen = HashSet::new();
        snap.day_notes.retain(|n| seen.insert(n.date.clone()));
        changed = true;
    }
    changed
}
