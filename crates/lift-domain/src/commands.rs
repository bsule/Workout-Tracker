//! Typed domain commands, independent of durable storage and UI.
use crate::{model::*, prs};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub fn seeds() -> Vec<ExerciseRow> {
    serde_json::from_str(include_str!("seeds.json")).expect("bundled seed catalog")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Command {
    UpdateSettings {
        patch: Value,
    },
    CreateExercise {
        name: String,
        category: String,
        kind: Option<String>,
    },
    PatchExercise {
        id: u64,
        patch: Value,
    },
    DeleteExercise {
        id: u64,
    },
    CreateWorkout {
        date: String,
    },
    PatchWorkout {
        id: u64,
        patch: Value,
    },
    DeleteWorkout {
        id: u64,
    },
    AddExercise {
        workout_id: u64,
        exercise_id: u64,
    },
    RemoveExercise {
        we_id: u64,
    },
    AddSet {
        we_id: u64,
        input: Value,
    },
    UpdateSet {
        set_id: u64,
        patch: Value,
    },
    LogPlannedSet {
        set_id: u64,
        patch: Value,
    },
    DeleteSets {
        ids: Vec<u64>,
    },
    CreateGym {
        name: String,
    },
    RenameGym {
        id: u64,
        name: String,
    },
    DeleteGym {
        id: u64,
    },
    SetDayNote {
        date: String,
        text: String,
    },
    SetExerciseNote {
        we_id: u64,
        text: String,
    },
    CopyWorkout {
        target_id: u64,
        source_id: u64,
        with_sets: bool,
    },
    RecomputePrs,
}
#[derive(Clone)]
pub struct Context {
    pub now: String,
    pub today: String,
    pub next_id: u64,
}
fn err(s: &str) -> String {
    s.to_string()
}
fn json<T: Serialize>(row: &T) -> Value {
    serde_json::to_value(row).expect("finite validated domain values")
}
fn gym_name(snap: &Snapshot, name: &str) -> String {
    snap.gyms
        .iter()
        .find(|g| g.name.to_lowercase() == name.trim().to_lowercase())
        .map(|g| g.name.clone())
        .unwrap_or_else(|| name.to_string())
}
fn merge<T: Serialize + for<'de> Deserialize<'de>>(
    row: &mut T,
    patch: Value,
    allowed: &[&str],
) -> Result<(), String> {
    let mut value = json(row);
    let obj = patch
        .as_object()
        .ok_or_else(|| err("Patch must be an object"))?;
    for (key, v) in obj {
        if allowed.contains(&key.as_str()) {
            value[key] = v.clone();
        }
    }
    *row = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(())
}
/// The caller prepares against an isolated working version, then persists and
/// publishes atomically. Never call directly against a visible committed state.
fn apply(snap: &mut Snapshot, command: Command, ctx: &mut Context) -> Result<Value, String> {
    let mut next_id = snap
        .exercises
        .iter()
        .map(|r| r.id)
        .chain(snap.workouts.iter().map(|r| r.id))
        .chain(snap.workout_exercises.iter().map(|r| r.id))
        .chain(snap.sets.iter().map(|r| r.id))
        .chain(snap.gyms.iter().map(|r| r.id))
        .max()
        .unwrap_or(0)
        + 1;
    next_id = next_id.max(ctx.next_id);
    let mut id = || {
        let n = next_id;
        next_id += 1;
        n
    };
    let mut affected = HashSet::new();
    let result = match command {
        Command::UpdateSettings { patch } => {
            let obj = patch
                .as_object()
                .ok_or_else(|| err("Settings patch must be an object"))?;
            let settings = snap
                .settings
                .as_object_mut()
                .ok_or_else(|| err("Invalid settings"))?;
            settings.extend(obj.clone());
            snap.settings.clone()
        }
        Command::CreateExercise {
            name,
            category,
            kind,
        } => {
            let row = ExerciseRow {
                id: id().max(seeds().len() as u64 + 1),
                name: name.trim().into(),
                category,
                kind: kind.unwrap_or_else(|| "weight_reps".into()),
                is_custom: true,
                is_deleted: None,
            };
            let out = json(&row);
            snap.exercises.push(row);
            out
        }
        Command::PatchExercise { id, patch } => {
            let existing = snap.exercises.iter().position(|e| e.id == id);
            let mut row = existing
                .map(|i| snap.exercises[i].clone())
                .or_else(|| seeds().into_iter().find(|e| e.id == id))
                .ok_or_else(|| err("Exercise not found"))?;
            let mut patch = patch;
            if let Some(name) = patch.get("name").and_then(Value::as_str) {
                let name = name.trim().to_string();
                if name.is_empty() {
                    return Ok(Value::Null);
                }
                patch["name"] = Value::String(name);
            }
            merge(&mut row, patch, &["name", "category"])?;
            let out = json(&row);
            if let Some(i) = existing {
                snap.exercises[i] = row;
            } else {
                snap.exercises.push(row);
            }
            out
        }
        Command::DeleteExercise { id } => {
            let existing = snap.exercises.iter().position(|e| e.id == id);
            let seed = seeds().into_iter().find(|e| e.id == id);
            if seed.is_some() || snap.workout_exercises.iter().any(|w| w.exercise_id == id) {
                if let Some(mut row) = existing.map(|i| snap.exercises[i].clone()).or(seed) {
                    row.is_deleted = Some(true);
                    if let Some(i) = existing {
                        snap.exercises[i] = row;
                    } else {
                        snap.exercises.push(row);
                    }
                }
            } else {
                snap.exercises.retain(|e| e.id != id);
            }
            Value::Null
        }
        Command::CreateWorkout { date } => {
            if let Some(w) = snap.workouts.iter().find(|w| w.date == date) {
                return Ok(
                    serde_json::json!({"row":w,"merged_into_finished":w.finished_at.is_some()}),
                );
            }
            let status = match date.cmp(&ctx.today) {
                std::cmp::Ordering::Less => "done",
                std::cmp::Ordering::Equal => "active",
                std::cmp::Ordering::Greater => "planned",
            };
            let gym = snap
                .workouts
                .iter()
                .filter(|w| w.date != date && !w.gym.is_empty())
                .max_by_key(|w| (&w.date, &w.created_at))
                .map(|w| w.gym.clone())
                .unwrap_or_default();
            let row = WorkoutRow {
                id: id(),
                date,
                status: status.into(),
                started_at: if status == "active" {
                    Some(ctx.now.clone())
                } else {
                    None
                },
                finished_at: None,
                gym,
                notes: String::new(),
                created_at: ctx.now.clone(),
            };
            let out = serde_json::json!({"row":row,"merged_into_finished":false});
            snap.workouts.push(row);
            out
        }
        Command::PatchWorkout { id: wid, patch } => {
            let mut patch = patch;
            if let Some(name) = patch.get("gym").and_then(Value::as_str) {
                if !name.trim().is_empty() {
                    patch["gym"] = Value::String(gym_name(snap, name));
                }
            }
            let row = snap
                .workouts
                .iter_mut()
                .find(|w| w.id == wid)
                .ok_or_else(|| err("Workout not found"))?;
            merge(
                row,
                patch,
                &["notes", "started_at", "finished_at", "gym", "status"],
            )?;
            let out = json(row);
            let name = row.gym.clone();
            if !name.is_empty()
                && !snap
                    .gyms
                    .iter()
                    .any(|g| g.name.to_lowercase() == name.trim().to_lowercase())
            {
                snap.gyms.push(GymRow { id: id(), name });
            }
            out
        }
        Command::DeleteWorkout { id } => {
            let wes: HashSet<_> = snap
                .workout_exercises
                .iter()
                .filter(|w| w.workout_id == id)
                .map(|w| {
                    affected.insert(w.exercise_id);
                    w.id
                })
                .collect();
            snap.workouts.retain(|w| w.id != id);
            snap.workout_exercises.retain(|w| !wes.contains(&w.id));
            snap.sets.retain(|s| !wes.contains(&s.workout_exercise_id));
            Value::Null
        }
        Command::AddExercise {
            workout_id,
            exercise_id,
        } => {
            if let Some(row) = snap
                .workout_exercises
                .iter()
                .find(|w| w.workout_id == workout_id && w.exercise_id == exercise_id)
            {
                return Ok(json(row));
            }
            let row = WorkoutExerciseRow {
                id: id(),
                workout_id,
                exercise_id,
                order: snap
                    .workout_exercises
                    .iter()
                    .filter(|w| w.workout_id == workout_id)
                    .count() as i64,
                note: String::new(),
            };
            let out = json(&row);
            snap.workout_exercises.push(row);
            out
        }
        Command::RemoveExercise { we_id } => {
            for w in &snap.workout_exercises {
                if w.id == we_id {
                    affected.insert(w.exercise_id);
                }
            }
            snap.workout_exercises.retain(|w| w.id != we_id);
            snap.sets.retain(|s| s.workout_exercise_id != we_id);
            Value::Null
        }
        Command::AddSet { we_id, input } => {
            let order = snap
                .sets
                .iter()
                .filter(|s| s.workout_exercise_id == we_id)
                .map(|s| s.order)
                .max()
                .unwrap_or(-1)
                + 1;
            let mut row: SetRow=serde_json::from_value(serde_json::json!({"id":id(),"workout_exercise_id":we_id,"weight":null,"reps":null,"distance_m":null,"distance_unit_display":"","time_seconds":null,"is_planned":false,"is_pr":false,"was_pr":false,"is_position_pr":false,"was_position_pr":false,"note":"","order":order,"created_at":ctx.now})).map_err(|e|e.to_string())?;
            let mut input = input;
            for key in [
                "weight",
                "reps",
                "distance_m",
                "distance_unit_display",
                "time_seconds",
                "note",
                "is_planned",
                "created_at",
            ] {
                if input.get(key).is_some_and(Value::is_null) {
                    input.as_object_mut().unwrap().remove(key);
                }
            }
            merge(
                &mut row,
                input,
                &[
                    "weight",
                    "reps",
                    "distance_m",
                    "distance_unit_display",
                    "time_seconds",
                    "note",
                    "is_planned",
                    "created_at",
                ],
            )?;
            if !row.is_planned {
                if let Some(w) = snap.workout_exercises.iter().find(|w| w.id == we_id) {
                    affected.insert(w.exercise_id);
                }
            }
            let out = json(&row);
            snap.sets.push(row);
            out
        }
        Command::UpdateSet { set_id, patch } | Command::LogPlannedSet { set_id, patch } => {
            // LogPlannedSet is normalized by apply_command below so this arm
            // remains a single field-patch operation.
            let row = snap
                .sets
                .iter_mut()
                .find(|s| s.id == set_id)
                .ok_or_else(|| err("Set not found"))?;
            let mut patch = patch;
            for key in ["weight", "reps", "note", "created_at"] {
                if patch.get(key).is_some_and(Value::is_null) {
                    patch.as_object_mut().unwrap().remove(key);
                }
            }
            merge(
                row,
                patch,
                &["weight", "reps", "note", "created_at", "is_planned"],
            )?;
            let out = json(row);
            let we = row.workout_exercise_id;
            if let Some(w) = snap.workout_exercises.iter().find(|w| w.id == we) {
                affected.insert(w.exercise_id);
            }
            out
        }
        Command::DeleteSets { ids } => {
            let ids: HashSet<_> = ids.into_iter().collect();
            let wes: HashSet<_> = snap
                .sets
                .iter()
                .filter(|s| ids.contains(&s.id))
                .map(|s| s.workout_exercise_id)
                .collect();
            for w in &snap.workout_exercises {
                if wes.contains(&w.id) {
                    affected.insert(w.exercise_id);
                }
            }
            snap.sets.retain(|s| !ids.contains(&s.id));
            Value::Null
        }
        Command::CreateGym { name } => {
            let name = name.trim().to_string();
            if let Some(g) = snap
                .gyms
                .iter()
                .find(|g| g.name.to_lowercase() == name.to_lowercase())
            {
                return Ok(json(g));
            }
            let row = GymRow { id: id(), name };
            let out = json(&row);
            snap.gyms.push(row);
            out
        }
        Command::RenameGym { id, name } => {
            let name = name.trim().to_string();
            if name.is_empty()
                || snap
                    .gyms
                    .iter()
                    .any(|g| g.id != id && g.name.to_lowercase() == name.to_lowercase())
            {
                return Ok(Value::Null);
            }
            let Some(row) = snap.gyms.iter_mut().find(|g| g.id == id) else {
                return Ok(Value::Null);
            };
            let old_name = row.name.clone();
            let old = old_name.to_lowercase();
            row.name = name.clone();
            let out = json(row);
            let others: HashSet<_> = snap
                .gyms
                .iter()
                .filter(|g| g.id != id)
                .map(|g| g.name.clone())
                .collect();
            for w in &mut snap.workouts {
                if w.gym == old_name || (w.gym.to_lowercase() == old && !others.contains(&w.gym)) {
                    w.gym = name.clone();
                }
            }
            out
        }
        Command::DeleteGym { id } => {
            snap.gyms.retain(|g| g.id != id);
            Value::Null
        }
        Command::SetDayNote { date, text } => {
            snap.day_notes.retain(|n| n.date != date);
            let text = text.trim().to_string();
            if !text.is_empty() {
                snap.day_notes.push(DayNoteRow { date, text });
            }
            Value::Null
        }
        Command::SetExerciseNote { we_id, text } => {
            if let Some(w) = snap.workout_exercises.iter_mut().find(|w| w.id == we_id) {
                w.note = text.trim().into();
            }
            Value::Null
        }
        Command::CopyWorkout {
            target_id,
            source_id,
            with_sets,
        } => {
            let source: Vec<_> = snap
                .workout_exercises
                .iter()
                .filter(|w| w.workout_id == source_id)
                .cloned()
                .collect();
            let mut order = snap
                .workout_exercises
                .iter()
                .filter(|w| w.workout_id == target_id)
                .count() as i64;
            for source_we in source {
                let row = WorkoutExerciseRow {
                    id: id(),
                    workout_id: target_id,
                    exercise_id: source_we.exercise_id,
                    order,
                    note: String::new(),
                };
                order += 1;
                if with_sets {
                    let mut sets: Vec<_> = snap
                        .sets
                        .iter()
                        .filter(|s| s.workout_exercise_id == source_we.id)
                        .cloned()
                        .collect();
                    sets.sort_by_key(|s| s.order);
                    for mut s in sets {
                        s.id = id();
                        s.workout_exercise_id = row.id;
                        s.created_at = ctx.now.clone();
                        s.is_pr = false;
                        s.was_pr = false;
                        s.is_position_pr = false;
                        s.was_position_pr = false;
                        snap.sets.push(s);
                        affected.insert(row.exercise_id);
                    }
                }
                snap.workout_exercises.push(row);
            }
            Value::Null
        }
        Command::RecomputePrs => {
            prs::recompute(snap, None);
            return Ok(
                serde_json::json!({"recomputed":snap.workout_exercises.iter().map(|w|w.exercise_id).collect::<HashSet<_>>().len()}),
            );
        }
    };
    if !affected.is_empty() {
        prs::recompute(snap, Some(&affected));
    }
    ctx.next_id = next_id;
    Ok(result)
}

pub fn apply_command(
    snap: &mut Snapshot,
    command: Command,
    ctx: &mut Context,
) -> Result<Value, String> {
    let command = match command {
        Command::LogPlannedSet { set_id, mut patch } => {
            let obj = patch
                .as_object_mut()
                .ok_or_else(|| err("Patch must be an object"))?;
            obj.insert("is_planned".into(), Value::Bool(false));
            if obj.get("created_at").is_none_or(Value::is_null) {
                obj.insert("created_at".into(), Value::String(ctx.now.clone()));
            }
            Command::UpdateSet { set_id, patch }
        }
        command => command,
    };
    apply(snap, command, ctx)
}
