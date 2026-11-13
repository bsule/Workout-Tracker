use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SCHEMA_VERSION: u32 = 9;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ExerciseRow {
    pub id: u64,
    pub name: String,
    pub category: String,
    pub kind: String,
    pub is_custom: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_deleted: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkoutRow {
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
pub struct WorkoutExerciseRow {
    pub id: u64,
    pub workout_id: u64,
    pub exercise_id: u64,
    pub order: i64,
    pub note: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SetRow {
    pub id: u64,
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
    pub order: i64,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GymRow {
    pub id: u64,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DayNoteRow {
    pub date: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub schema_version: u32,
    pub exported_at: String,
    pub device_id: String,
    pub settings: Value,
    pub exercises: Vec<ExerciseRow>,
    pub workouts: Vec<WorkoutRow>,
    pub workout_exercises: Vec<WorkoutExerciseRow>,
    pub sets: Vec<SetRow>,
    pub gyms: Vec<GymRow>,
    pub day_notes: Vec<DayNoteRow>,
}

impl Snapshot {
    pub fn empty(device_id: String, now: String) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            exported_at: now,
            device_id,
            settings: serde_json::json!({"weight_unit":"lb","first_day_of_week":0}),
            exercises: vec![],
            workouts: vec![],
            workout_exercises: vec![],
            sets: vec![],
            gyms: vec![],
            day_notes: vec![],
        }
    }
}

/// Validate structural invariants before making an imported dataset active.
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
