use crate::{lenient, table::Table};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_VERSION: u32 = 9;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(default)]
pub struct ExerciseRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub id: u64,
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
    #[serde(deserialize_with = "lenient::string")]
    pub category: String,
    #[serde(deserialize_with = "lenient::string")]
    pub kind: String,
    #[serde(deserialize_with = "lenient::boolean")]
    pub is_custom: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub is_deleted: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(default)]
pub struct WorkoutRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub id: u64,
    #[serde(deserialize_with = "lenient::string")]
    pub date: String,
    #[serde(deserialize_with = "lenient::string")]
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[serde(deserialize_with = "lenient::string")]
    pub gym: String,
    #[serde(deserialize_with = "lenient::string")]
    pub notes: String,
    #[serde(deserialize_with = "lenient::string")]
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(default)]
pub struct WorkoutExerciseRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub workout_id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub exercise_id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::integer")]
    pub order: i64,
    #[serde(deserialize_with = "lenient::string")]
    pub note: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(default)]
pub struct SetRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub workout_exercise_id: u64,
    pub weight: Option<f64>,
    pub reps: Option<f64>,
    pub distance_m: Option<f64>,
    #[serde(deserialize_with = "lenient::string")]
    pub distance_unit_display: String,
    pub time_seconds: Option<f64>,
    #[serde(deserialize_with = "lenient::boolean")]
    pub is_planned: bool,
    #[serde(deserialize_with = "lenient::boolean")]
    pub is_pr: bool,
    #[serde(deserialize_with = "lenient::boolean")]
    pub was_pr: bool,
    #[serde(deserialize_with = "lenient::boolean")]
    pub is_position_pr: bool,
    #[serde(deserialize_with = "lenient::boolean")]
    pub was_position_pr: bool,
    #[serde(deserialize_with = "lenient::string")]
    pub note: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::integer")]
    pub order: i64,
    #[serde(deserialize_with = "lenient::string")]
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(default)]
pub struct GymRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    #[serde(deserialize_with = "lenient::id")]
    pub id: u64,
    #[serde(deserialize_with = "lenient::string")]
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(default)]
pub struct DayNoteRow {
    #[serde(deserialize_with = "lenient::string")]
    pub date: String,
    #[serde(deserialize_with = "lenient::string")]
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Snapshot {
    #[serde(default, deserialize_with = "lenient::version")]
    pub schema_version: u32,
    #[serde(default, deserialize_with = "lenient::string")]
    pub exported_at: String,
    #[serde(default, deserialize_with = "lenient::string")]
    pub device_id: String,
    #[serde(default = "empty_settings", deserialize_with = "lenient::settings")]
    pub settings: Value,
    pub exercises: Table<ExerciseRow>,
    pub workouts: Table<WorkoutRow>,
    pub workout_exercises: Table<WorkoutExerciseRow>,
    pub sets: Table<SetRow>,
    pub gyms: Table<GymRow>,
    #[serde(default, deserialize_with = "lenient::table")]
    pub day_notes: Table<DayNoteRow>,
}
/// The snapshot fields outside the tables, as stored in a database header.
#[derive(Deserialize)]
pub struct Header {
    #[serde(default, deserialize_with = "lenient::version")]
    pub schema_version: u32,
    #[serde(default, deserialize_with = "lenient::string")]
    pub exported_at: String,
    #[serde(default, deserialize_with = "lenient::string")]
    pub device_id: String,
    #[serde(default = "empty_settings", deserialize_with = "lenient::settings")]
    pub settings: Value,
}
impl Header {
    pub fn into_snapshot(self) -> Snapshot {
        let mut s = Snapshot::empty(self.device_id, self.exported_at);
        s.schema_version = self.schema_version;
        s.settings = self.settings;
        s
    }
}
fn empty_settings() -> Value {
    Value::Object(Default::default())
}

impl Snapshot {
    pub fn empty(device_id: String, now: String) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            exported_at: now,
            device_id,
            settings: serde_json::json!({"weight_unit":"lb","first_day_of_week":0}),
            exercises: Table::default(),
            workouts: Table::default(),
            workout_exercises: Table::default(),
            sets: Table::default(),
            gyms: Table::default(),
            day_notes: Table::default(),
        }
    }
}

/// Validate structural invariants before making a dataset active.
/// Orphan references remain legal for compatibility with legacy recovery.
pub fn validate(snapshot: &Snapshot) -> Result<(), String> {
    if snapshot.schema_version > SCHEMA_VERSION {
        return Err("Unsupported snapshot schema".into());
    }
    if !snapshot.settings.is_object() {
        return Err("Invalid settings object".into());
    }
    fn ids(values: impl Iterator<Item = u64>) -> Result<(), String> {
        let mut seen = std::collections::HashSet::new();
        for id in values {
            if id > 9_007_199_254_740_991 || !seen.insert(id) {
                return Err("Duplicate or unsafe record ID".into());
            }
        }
        Ok(())
    }
    ids(snapshot.exercises.iter().map(|r| r.id))?;
    ids(snapshot.workouts.iter().map(|r| r.id))?;
    ids(snapshot.workout_exercises.iter().map(|r| r.id))?;
    ids(snapshot.sets.iter().map(|r| r.id))?;
    ids(snapshot.gyms.iter().map(|r| r.id))?;
    let mut dates = std::collections::HashSet::new();
    if snapshot
        .day_notes
        .iter()
        .any(|n| !dates.insert(n.date.as_str()))
    {
        return Err("Duplicate day note date".into());
    }
    for s in &snapshot.sets {
        if [s.weight, s.reps, s.distance_m, s.time_seconds]
            .into_iter()
            .flatten()
            .any(|v| !v.is_finite())
        {
            return Err("Non-finite set value".into());
        }
    }
    Ok(())
}

/// Repairs data an older build could write, applied on every load, import and
/// replacement. Returns true when anything changed.
///
/// - A repeated record id keeps its last row, the one the TypeScript id maps
///   resolved, and earlier rows get fresh ids. (createExercise could hand out
///   one exercise id twice before the allocator passed the built-in range.)
/// - Gyms whose name repeats an earlier row exactly, and repeated day-note
///   dates, keep the first row (dedupeGyms; getDayNote showed the first).
pub fn repair(snap: &mut Snapshot) -> bool {
    use std::collections::HashMap;
    fn duplicates<T>(t: &Table<T>, id: impl Fn(&T) -> u64) -> Vec<usize> {
        let mut last: HashMap<u64, usize> = HashMap::new();
        for (i, row) in t.iter().enumerate() {
            last.insert(id(row), i);
        }
        if last.len() == t.len() {
            return vec![];
        }
        t.iter()
            .enumerate()
            .filter(|(i, row)| last[&id(row)] != *i)
            .map(|(i, _)| i)
            .collect()
    }
    let mut changed = false;
    let mut next = crate::commands::next_available_id(snap);
    let mut fresh = |floor: u64| {
        next = next.max(floor);
        let n = next;
        next += 1;
        n
    };
    let custom_floor = crate::commands::seed_catalog().len() as u64 + 1;
    for p in duplicates(&snap.exercises, |r| r.id) {
        snap.exercises[p].id = fresh(custom_floor);
        changed = true;
    }
    for p in duplicates(&snap.workouts, |r| r.id) {
        snap.workouts[p].id = fresh(0);
        changed = true;
    }
    for p in duplicates(&snap.workout_exercises, |r| r.id) {
        snap.workout_exercises[p].id = fresh(0);
        changed = true;
    }
    for p in duplicates(&snap.sets, |r| r.id) {
        snap.sets[p].id = fresh(0);
        changed = true;
    }
    for p in duplicates(&snap.gyms, |r| r.id) {
        snap.gyms[p].id = fresh(0);
        changed = true;
    }
    crate::gyms::repair(snap) || changed
}
