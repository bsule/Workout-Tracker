use crate::table::Table;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_VERSION: u32 = 9;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ExerciseRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub id: u64,
    pub name: String,
    pub category: String,
    pub kind: String,
    pub is_custom: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub is_deleted: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct WorkoutRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub id: u64,
    pub date: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub gym: String,
    pub notes: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct WorkoutExerciseRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub workout_id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub exercise_id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub order: i64,
    pub note: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SetRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub id: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub workout_exercise_id: u64,
    pub weight: Option<f64>,
    pub reps: Option<f64>,
    pub distance_m: Option<f64>,
    pub distance_unit_display: String,
    pub time_seconds: Option<f64>,
    pub is_planned: bool,
    pub is_pr: bool,
    pub was_pr: bool,
    pub is_position_pr: bool,
    pub was_position_pr: bool,
    pub note: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub order: i64,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GymRow {
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub id: u64,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DayNoteRow {
    pub date: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Snapshot {
    pub schema_version: u32,
    pub exported_at: String,
    pub device_id: String,
    pub settings: Value,
    pub exercises: Table<ExerciseRow>,
    pub workouts: Table<WorkoutRow>,
    pub workout_exercises: Table<WorkoutExerciseRow>,
    pub sets: Table<SetRow>,
    pub gyms: Table<GymRow>,
    pub day_notes: Table<DayNoteRow>,
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

/// Validate structural invariants before making an imported dataset active.
/// Orphan references remain legal for compatibility with legacy recovery.
pub fn validate(snapshot: &Snapshot) -> Result<(), String> {
    validate_tables(snapshot, None)
}
/// `base` must be a validated, immutable committed snapshot. Shared tables
/// cannot have changed; table mutation detaches through Arc::make_mut.
pub fn validate_changed(snapshot: &Snapshot, base: &Snapshot) -> Result<(), String> {
    validate_tables(snapshot, Some(base))
}
fn validate_tables(snapshot: &Snapshot, base: Option<&Snapshot>) -> Result<(), String> {
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
    if base.is_none_or(|b| !snapshot.exercises.shares_storage_with(&b.exercises)) {
        ids(snapshot.exercises.iter().map(|r| r.id))?;
    }
    if base.is_none_or(|b| !snapshot.workouts.shares_storage_with(&b.workouts)) {
        ids(snapshot.workouts.iter().map(|r| r.id))?;
    }
    if base.is_none_or(|b| {
        !snapshot
            .workout_exercises
            .shares_storage_with(&b.workout_exercises)
    }) {
        ids(snapshot.workout_exercises.iter().map(|r| r.id))?;
    }
    if base.is_none_or(|b| !snapshot.sets.shares_storage_with(&b.sets)) {
        ids(snapshot.sets.iter().map(|r| r.id))?;
    }
    if base.is_none_or(|b| !snapshot.gyms.shares_storage_with(&b.gyms)) {
        ids(snapshot.gyms.iter().map(|r| r.id))?;
    }
    if base.is_none_or(|b| !snapshot.sets.shares_storage_with(&b.sets)) {
        for s in &snapshot.sets {
            if [s.weight, s.reps, s.distance_m, s.time_seconds]
                .into_iter()
                .flatten()
                .any(|v| !v.is_finite())
            {
                return Err("Non-finite set value".into());
            }
        }
    }
    Ok(())
}
