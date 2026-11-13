use lift_domain::{commands::seeds, model::ExerciseRow};
use std::collections::{HashMap, HashSet};
use unicode_normalization::UnicodeNormalization;
pub fn normalize(name: &str) -> String {
    name.nfc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn key(name: &str) -> String {
    normalize(name).to_lowercase()
}
pub struct ExerciseLookup {
    names: HashMap<String, ExerciseRow>,
    builtin: HashSet<u64>,
    kinds: HashMap<(String, String), ExerciseRow>,
}
impl ExerciseLookup {
    pub fn new<'a>(existing: impl IntoIterator<Item = &'a ExerciseRow> + Clone) -> Self {
        let touched: HashSet<_> = existing.clone().into_iter().map(|e| e.id).collect();
        let mut names = HashMap::new();
        let mut builtin = HashSet::new();
        for e in seeds() {
            if !touched.contains(&e.id) {
                builtin.insert(e.id);
                names.insert(key(&e.name), e);
            }
        }
        for e in existing {
            if e.is_deleted != Some(true) {
                names.insert(key(&e.name), e.clone());
            }
        }
        Self {
            names,
            builtin,
            kinds: HashMap::new(),
        }
    }
    pub fn find(&self, name: &str, kind: Option<&str>) -> Option<&ExerciseRow> {
        let k = key(name);
        let row = self.names.get(&k)?;
        if let Some(kind) = kind {
            if self.builtin.contains(&row.id) && row.kind != kind {
                return self.kinds.get(&(k, kind.into()));
            }
        }
        Some(row)
    }
    pub fn add(&mut self, row: ExerciseRow) {
        let k = key(&row.name);
        if self
            .names
            .get(&k)
            .is_some_and(|e| self.builtin.contains(&e.id) && e.kind != row.kind)
        {
            self.kinds.insert((k, row.kind.clone()), row);
        } else {
            self.names.insert(k, row);
        }
    }
}
