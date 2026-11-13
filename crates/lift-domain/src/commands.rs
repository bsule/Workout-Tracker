//! Typed domain commands, independent of durable storage and UI.
use crate::{gyms, lookup::Lookup, model::*, prs, queries::Indexes};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub fn seed_catalog() -> &'static [ExerciseRow] {
    static CATALOG: std::sync::OnceLock<Vec<ExerciseRow>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("seeds.json")).expect("bundled seed catalog")
    })
}
pub fn seeds() -> Vec<ExerciseRow> {
    seed_catalog().to_vec()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(tag = "op", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", ts(export_to = "commands.ts"))]
pub enum Command {
    LogSet {
        date: String,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
        input: Value,
    },
    ApplyAiPlan {
        plan: Value,
        unit: String,
    },
    UpdateSettings {
        patch: Value,
    },
    CreateExercise {
        name: String,
        category: String,
        kind: Option<String>,
    },
    PatchExercise {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
        patch: Value,
    },
    DeleteExercise {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
    },
    CreateWorkout {
        date: String,
    },
    PatchWorkout {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
        patch: Value,
    },
    DeleteWorkout {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
    },
    AddExercise {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        workout_id: u64,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
    },
    RemoveExercise {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        we_id: u64,
    },
    AddSet {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        we_id: u64,
        input: Value,
    },
    UpdateSet {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        set_id: u64,
        patch: Value,
    },
    LogPlannedSet {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        set_id: u64,
        patch: Value,
    },
    DeleteSets {
        #[cfg_attr(feature = "typescript", ts(type = "number[]"))]
        ids: Vec<u64>,
    },
    CreateGym {
        name: String,
    },
    RenameGym {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
        name: String,
    },
    DeleteGym {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
    },
    SetDayNote {
        date: String,
        text: String,
    },
    SetExerciseNote {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        we_id: u64,
        text: String,
    },
    CopyWorkout {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        target_id: u64,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
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
fn drop_nulls(v: &mut Value, keys: &[&str]) {
    if let Some(obj) = v.as_object_mut() {
        for key in keys {
            if obj.get(*key).is_some_and(Value::is_null) {
                obj.remove(*key);
            }
        }
    }
}
fn seed(id: u64) -> Option<ExerciseRow> {
    seed_catalog().iter().find(|e| e.id == id).cloned()
}
/// Most recent workout's gym on another date, by (date, created_at), as
/// findLastUsedGym: the first of equal keys wins.
fn last_used_gym(snap: &Snapshot, exclude: &str) -> String {
    let mut best: Option<&WorkoutRow> = None;
    for w in &snap.workouts {
        if w.date == exclude || w.gym.is_empty() {
            continue;
        }
        if best.is_none_or(|b| w.date > b.date || (w.date == b.date && w.created_at > b.created_at))
        {
            best = Some(w);
        }
    }
    best.map(|w| w.gym.clone()).unwrap_or_default()
}
/// The caller prepares against an isolated working version, then persists and
/// publishes atomically. Never call directly against a visible committed state.
fn apply(
    snap: &mut Snapshot,
    command: Command,
    ctx: &mut Context,
    look: &Lookup,
) -> Result<Value, String> {
    let mut next_id = ctx.next_id;
    if matches!(&command, Command::CreateExercise { .. }) {
        next_id = next_id.max(seed_catalog().len() as u64 + 1);
    }
    let returns_set = matches!(
        &command,
        Command::AddSet { .. } | Command::UpdateSet { .. } | Command::LogPlannedSet { .. }
    );
    let mut id = || {
        let n = next_id;
        next_id += 1;
        n
    };
    let mut affected = HashSet::new();
    let result = match command {
        Command::LogSet {
            date,
            exercise_id,
            input,
        } => {
            // The set logger's first save: the date's workout and the
            // exercise's row on it are reused when they exist.
            let workout = apply(snap, Command::CreateWorkout { date }, ctx, look)?;
            let wid = workout["row"]["id"]
                .as_u64()
                .ok_or("Workout creation failed")?;
            let we = apply(
                snap,
                Command::AddExercise {
                    workout_id: wid,
                    exercise_id,
                },
                ctx,
                look,
            )?;
            let we_id = we["id"].as_u64().ok_or("Exercise attachment failed")?;
            let set = apply(snap, Command::AddSet { we_id, input }, ctx, look)?;
            let set_id = set["id"].as_u64().ok_or("Set creation failed")?;
            let row = look
                .set_pos(snap, set_id)
                .map(|i| &snap.sets[i])
                .ok_or("Set missing after commit")?;
            return Ok(
                serde_json::json!({"workout_id":wid,"we_id":we_id,"set_id":set_id,"set":row,"merged_into_finished":workout["merged_into_finished"]}),
            );
        }

        Command::ApplyAiPlan { plan, unit } => {
            return crate::ai::apply_indexed(
                snap,
                &plan,
                if unit == "kg" {
                    crate::units::WeightUnit::Kg
                } else {
                    crate::units::WeightUnit::Lb
                },
                ctx,
                look,
            )
        }
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
                id: id().max(seed_catalog().len() as u64 + 1),
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
            let existing = look.exercise_pos(snap, id);
            let mut row = existing
                .map(|i| snap.exercises[i].clone())
                .or_else(|| seed(id))
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
            let existing = look.exercise_pos(snap, id);
            let seed = seed(id);
            let referenced = snap.workout_exercises.iter().any(|w| w.exercise_id == id);
            if seed.is_some() || referenced {
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
            if let Some(i) = look.workout_by_date(snap, &date) {
                let w = &snap.workouts[i];
                return Ok(
                    serde_json::json!({"row":w,"merged_into_finished":w.finished_at.is_some()}),
                );
            }
            let status = match date.cmp(&ctx.today) {
                std::cmp::Ordering::Less => "done",
                std::cmp::Ordering::Equal => "active",
                std::cmp::Ordering::Greater => "planned",
            };
            let gym = last_used_gym(snap, &date);
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
            // A typed gym is stored in the saved gym's spelling, or trimmed.
            let mut patch = patch;
            let mut effective_gym = None;
            if let Some(name) = patch.get("gym").and_then(Value::as_str).map(str::to_string) {
                let name = if name.trim().is_empty() {
                    name
                } else {
                    gyms::find_saved_gym(snap.gyms.iter(), &name)
                        .map(|g| g.name.clone())
                        .unwrap_or_else(|| name.trim().to_string())
                };
                patch["gym"] = Value::String(name.clone());
                effective_gym = Some(name);
            }
            let i = look
                .workout_pos(snap, wid)
                .ok_or_else(|| err("Workout not found"))?;
            let mut row = snap.workouts[i].clone();
            merge(
                &mut row,
                patch,
                &["notes", "started_at", "finished_at", "gym", "status"],
            )?;
            let out = json(&row);
            snap.workouts[i] = row;
            if let Some(name) = effective_gym.filter(|n| !n.is_empty()) {
                if gyms::find_saved_gym(snap.gyms.iter(), &name).is_none() {
                    snap.gyms.push(GymRow { id: id(), name });
                }
            }
            out
        }
        Command::DeleteWorkout { id } => {
            let wes: HashSet<_> = look
                .wes_of_workout(snap, id)
                .into_iter()
                .map(|p| {
                    let w = &snap.workout_exercises[p];
                    affected.insert(w.exercise_id);
                    w.id
                })
                .collect();
            snap.workouts.retain(|w| w.id != id);
            if !wes.is_empty() {
                snap.workout_exercises.retain(|w| !wes.contains(&w.id));
                snap.sets.retain(|s| !wes.contains(&s.workout_exercise_id));
            }
            Value::Null
        }
        Command::AddExercise {
            workout_id,
            exercise_id,
        } => {
            let siblings = look.wes_of_workout(snap, workout_id);
            if let Some(p) = siblings
                .iter()
                .find(|p| snap.workout_exercises[**p].exercise_id == exercise_id)
            {
                return Ok(json(&snap.workout_exercises[*p]));
            }
            let row = WorkoutExerciseRow {
                id: id(),
                workout_id,
                exercise_id,
                order: siblings.len() as i64,
                note: String::new(),
            };
            let out = json(&row);
            snap.workout_exercises.push(row);
            out
        }
        Command::RemoveExercise { we_id } => {
            if let Some(p) = look.we_pos(snap, we_id) {
                affected.insert(snap.workout_exercises[p].exercise_id);
                snap.workout_exercises.retain(|w| w.id != we_id);
                snap.sets.retain(|s| s.workout_exercise_id != we_id);
            }
            Value::Null
        }
        Command::AddSet { we_id, input } => {
            let order = look
                .sets_of_we(snap, we_id)
                .into_iter()
                .map(|p| snap.sets[p].order)
                .max()
                .unwrap_or(-1)
                + 1;
            let mut row: SetRow=serde_json::from_value(serde_json::json!({"id":id(),"workout_exercise_id":we_id,"weight":null,"reps":null,"distance_m":null,"distance_unit_display":"","time_seconds":null,"is_planned":false,"is_pr":false,"was_pr":false,"is_position_pr":false,"was_position_pr":false,"note":"","order":order,"created_at":ctx.now})).map_err(|e|e.to_string())?;
            let mut input = input;
            let keys = [
                "weight",
                "reps",
                "distance_m",
                "distance_unit_display",
                "time_seconds",
                "note",
                "is_planned",
                "created_at",
            ];
            drop_nulls(&mut input, &keys);
            merge(&mut row, input, &keys)?;
            let planned = row.is_planned;
            let out = json(&row);
            snap.sets.push(row);
            if !planned {
                if let Some(p) = look.we_pos(snap, we_id) {
                    let exercise = snap.workout_exercises[p].exercise_id;
                    let pos = snap.sets.len() - 1;
                    if !prs::append_fast(snap, exercise, pos, look) {
                        affected.insert(exercise);
                    }
                }
            }
            out
        }
        Command::UpdateSet { set_id, patch } => {
            update_set(snap, set_id, patch, false, look, &mut affected)?
        }
        Command::LogPlannedSet { set_id, patch } => {
            update_set(snap, set_id, patch, true, look, &mut affected)?
        }
        Command::DeleteSets { ids } => {
            let ids: HashSet<_> = ids.into_iter().collect();
            let mut positions = vec![];
            for id in &ids {
                if let Some(p) = look.set_pos(snap, *id) {
                    let row = &snap.sets[p];
                    if let Some(wp) = look.we_pos(snap, row.workout_exercise_id) {
                        let exercise = snap.workout_exercises[wp].exercise_id;
                        // A planned row cannot affect candidates or positions.
                        // Keep the full repair pass when loaded flags are untrusted.
                        if !row.is_planned || !look.is_verified(exercise) {
                            affected.insert(exercise);
                        }
                    }
                    positions.push(p);
                }
            }
            if !positions.is_empty() {
                let indexed = look.can_record_set_deletions(snap);
                positions.sort_unstable();
                snap.sets.remove_positions(&positions);
                if indexed {
                    look.record_set_deletions(snap, positions);
                }
            }
            Value::Null
        }
        Command::CreateGym { name } => {
            let name = name.trim().to_string();
            if let Some(g) = gyms::find_saved_gym(snap.gyms.iter(), &name) {
                return Ok(json(g));
            }
            let row = GymRow { id: id(), name };
            let out = json(&row);
            snap.gyms.push(row);
            out
        }
        Command::RenameGym { id, name } => {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Ok(Value::Null);
            }
            let Some(idx) = snap.gyms.position(|g| g.id == id) else {
                return Ok(Value::Null);
            };
            if snap.gyms[idx].name == name {
                return Ok(json(&snap.gyms[idx]));
            }
            let lower = name.to_lowercase();
            if snap
                .gyms
                .iter()
                .enumerate()
                .any(|(i, g)| i != idx && g.name.to_lowercase() == lower)
            {
                return Ok(Value::Null);
            }
            gyms::rename_gym_in(snap, id, &name);
            json(&snap.gyms[idx])
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
            let text = text.trim().to_string();
            if let Some(p) = look.we_pos(snap, we_id) {
                if snap.workout_exercises[p].note != text {
                    snap.workout_exercises[p].note = text;
                }
            }
            Value::Null
        }
        Command::CopyWorkout {
            target_id,
            source_id,
            with_sets,
        } => {
            let source: Vec<_> = look
                .wes_of_workout(snap, source_id)
                .into_iter()
                .map(|p| snap.workout_exercises[p].clone())
                .collect();
            let mut order = look.wes_of_workout(snap, target_id).len() as i64;
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
                    let mut sets: Vec<_> = look
                        .sets_of_we(snap, source_we.id)
                        .into_iter()
                        .map(|p| snap.sets[p].clone())
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
            look.mark_all_verified();
            return Ok(
                serde_json::json!({"recomputed":snap.workout_exercises.iter().map(|w|w.exercise_id).collect::<HashSet<_>>().len()}),
            );
        }
    };
    if !affected.is_empty() {
        prs::recompute_indexed(snap, &affected, look);
    }
    ctx.next_id = next_id;
    if returns_set {
        if let Some(row) = result["id"]
            .as_u64()
            .and_then(|id| look.set_pos(snap, id))
            .map(|p| &snap.sets[p])
        {
            return Ok(json(row));
        }
    }
    Ok(result)
}

/// updateSet / logPlannedSet: weight, reps and note keep the old value when
/// absent or null. Logging a planned set also clears `is_planned` and stamps
/// the tap time (or now).
fn update_set(
    snap: &mut Snapshot,
    set_id: u64,
    patch: Value,
    log_planned: bool,
    look: &Lookup,
    affected: &mut HashSet<u64>,
) -> Result<Value, String> {
    if !patch.is_object() {
        return Err(err("Patch must be an object"));
    }
    let p = look
        .set_pos(snap, set_id)
        .ok_or_else(|| err("Set not found"))?;
    let mut patch = patch;
    drop_nulls(&mut patch, &["weight", "reps", "note", "created_at"]);
    let mut row = snap.sets[p].clone();
    merge(&mut row, patch, &["weight", "reps", "note", "created_at"])?;
    if log_planned {
        row.is_planned = false;
    }
    let out = json(&row);
    let we = row.workout_exercise_id;
    snap.sets[p] = row;
    if let Some(w) = look.we_pos(snap, we) {
        affected.insert(snap.workout_exercises[w].exercise_id);
    }
    Ok(out)
}

pub fn apply_command(
    snap: &mut Snapshot,
    command: Command,
    ctx: &mut Context,
) -> Result<Value, String> {
    ctx.next_id = ctx.next_id.max(next_available_id(snap));
    apply_command_trusted(snap, command, ctx)
}
pub fn next_available_id(snap: &Snapshot) -> u64 {
    snap.exercises
        .iter()
        .map(|r| r.id)
        .chain(snap.workouts.iter().map(|r| r.id))
        .chain(snap.workout_exercises.iter().map(|r| r.id))
        .chain(snap.sets.iter().map(|r| r.id))
        .chain(snap.gyms.iter().map(|r| r.id))
        .max()
        .unwrap_or(0)
        + 1
}
/// Applies a command after indexing `snap`. Engines use
/// `apply_command_indexed` with the committed snapshot's indexes instead.
pub fn apply_command_trusted(
    snap: &mut Snapshot,
    command: Command,
    ctx: &mut Context,
) -> Result<Value, String> {
    let ix = Indexes::build(snap);
    let look = Lookup::new(&ix, snap);
    apply_command_indexed(snap, command, ctx, &look)
}
/// Engine entry point: `look` indexes the committed snapshot `snap` was
/// cloned from. The allocator is validated on open and persisted with every
/// commit, so ordinary edits do not rescan all record IDs to allocate one set.
pub fn apply_command_indexed(
    snap: &mut Snapshot,
    command: Command,
    ctx: &mut Context,
    look: &Lookup,
) -> Result<Value, String> {
    let command = match command {
        Command::LogPlannedSet { set_id, mut patch } => {
            let obj = patch
                .as_object_mut()
                .ok_or_else(|| err("Patch must be an object"))?;
            if obj.get("created_at").is_none_or(Value::is_null) {
                obj.insert("created_at".into(), Value::String(ctx.now.clone()));
            }
            Command::LogPlannedSet { set_id, patch }
        }
        command => command,
    };
    apply(snap, command, ctx, look)
}
