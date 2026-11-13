//! Compatibility replay for the legacy pending.log. Missing copy_from inputs
//! cannot be reconstructed; those entries retain the legacy no-op behavior.
//!
//! PR flags are derived from the final rows, and no logged operation reads
//! them, so the exercises every operation touched are recomputed once at the
//! end. That gives the same flags as the TypeScript per-operation recompute.
use crate::{invalid, CodecError};
use lift_domain::{model::Snapshot, prs};
use serde_json::{json, Value};
use std::collections::HashSet;
fn id(op: &Value, key: &str) -> u64 {
    op[key].as_u64().unwrap_or(0)
}
fn rows<'a>(s: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>, CodecError> {
    s[key]
        .as_array_mut()
        .ok_or_else(|| invalid(format!("Invalid table {key}")))
}
fn add(s: &mut Value, table: &str, row: &Value) -> Result<(), CodecError> {
    if !row.is_object() {
        // TypeScript would fail the whole boot on such a line; skipping it
        // keeps every other logged change.
        return Ok(());
    }
    let rows = rows(s, table)?;
    if !rows.iter().any(|r| r["id"] == row["id"]) {
        rows.push(row.clone());
    }
    Ok(())
}
fn patch(s: &mut Value, table: &str, target: u64, patch: &Value) -> Result<(), CodecError> {
    let Some(patch) = patch.as_object() else {
        return Ok(());
    };
    if let Some(row) = rows(s, table)?.iter_mut().find(|r| id(r, "id") == target) {
        row.as_object_mut()
            .ok_or_else(|| invalid("Invalid logged target"))?
            .extend(patch.clone());
    }
    Ok(())
}
pub fn replay(mut s: Value, lines: &str, now: &str) -> Result<Value, CodecError> {
    if !s.is_object() {
        return Err(invalid("Snapshot must be an object"));
    }
    for key in [
        "exercises",
        "workouts",
        "workout_exercises",
        "sets",
        "gyms",
        "day_notes",
    ] {
        if !s[key].is_array() {
            s[key] = json!([]);
        }
    }
    if !s["settings"].is_object() {
        s["settings"] = json!({});
    }
    let mut affected = HashSet::new();
    for line in lines.lines() {
        let Ok(op) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if !op.is_object() {
            continue;
        }
        let exercise_of_we = |we: u64| {
            s["workout_exercises"]
                .as_array()
                .and_then(|rows| rows.iter().find(|r| id(r, "id") == we))
                .map(|r| id(r, "exercise_id"))
        };
        let exercise_of_set = |set: u64| {
            s["sets"]
                .as_array()
                .and_then(|rows| rows.iter().find(|r| id(r, "id") == set))
                .and_then(|r| exercise_of_we(id(r, "workout_exercise_id")))
        };
        match op["op"].as_str().unwrap_or("") {
            "add_set" => {
                if op["row"]["is_planned"] != true {
                    if let Some(ex) = exercise_of_we(id(&op["row"], "workout_exercise_id")) {
                        affected.insert(ex);
                    }
                }
            }
            "update_set" | "log_planned_set" | "delete_set" => {
                if let Some(ex) = exercise_of_set(id(&op, "setId")) {
                    affected.insert(ex);
                }
            }
            "remove_exercise" => {
                if let Some(ex) = exercise_of_we(id(&op, "weId")) {
                    affected.insert(ex);
                }
            }
            "delete_workout" => {
                for we in s["workout_exercises"].as_array().into_iter().flatten() {
                    if id(we, "workout_id") == id(&op, "id") {
                        affected.insert(id(we, "exercise_id"));
                    }
                }
            }
            _ => {}
        }
        match op["op"].as_str().unwrap_or("") {
            "update_settings" => {
                if let Some(p) = op["patch"].as_object() {
                    s["settings"]
                        .as_object_mut()
                        .ok_or_else(|| invalid("Invalid settings"))?
                        .extend(p.clone());
                }
            }
            "create_exercise" => add(&mut s, "exercises", &op["row"])?,
            "patch_exercise" => {
                let target = id(&op, "id");
                if op["row"].is_object() {
                    add(&mut s, "exercises", &op["row"])?;
                    patch(&mut s, "exercises", target, &op["row"])?;
                } else {
                    patch(&mut s, "exercises", target, &op["patch"])?;
                }
            }
            "delete_exercise" => {
                if op["row"].is_object() {
                    add(&mut s, "exercises", &op["row"])?;
                }
                patch(
                    &mut s,
                    "exercises",
                    id(&op, "id"),
                    &json!({"is_deleted":true}),
                )?;
            }
            "create_workout" => add(&mut s, "workouts", &op["row"])?,
            "patch_workout" => patch(&mut s, "workouts", id(&op, "id"), &op["patch"])?,
            "delete_workout" => {
                let target = id(&op, "id");
                let removed: HashSet<_> = rows(&mut s, "workout_exercises")?
                    .iter()
                    .filter(|r| id(r, "workout_id") == target)
                    .map(|r| id(r, "id"))
                    .collect();
                rows(&mut s, "workouts")?.retain(|r| id(r, "id") != target);
                rows(&mut s, "workout_exercises")?.retain(|r| !removed.contains(&id(r, "id")));
                rows(&mut s, "sets")?.retain(|r| !removed.contains(&id(r, "workout_exercise_id")));
            }
            "add_exercise" => add(&mut s, "workout_exercises", &op["row"])?,
            "remove_exercise" => {
                let target = id(&op, "weId");
                rows(&mut s, "workout_exercises")?.retain(|r| id(r, "id") != target);
                rows(&mut s, "sets")?.retain(|r| id(r, "workout_exercise_id") != target);
            }
            "add_set" => {
                let mut row = op["row"].clone();
                if row.is_object() {
                    if row.get("is_position_pr").is_none_or(Value::is_null) {
                        row["is_position_pr"] = json!(false);
                    }
                    if row.get("was_position_pr").is_none_or(Value::is_null) {
                        row["was_position_pr"] = json!(false);
                    }
                    add(&mut s, "sets", &row)?;
                }
            }
            "update_set" | "log_planned_set" => {
                let mut p = op["patch"].clone();
                if !p.is_object() {
                    p = json!({});
                }
                if op["op"] == "log_planned_set" {
                    p["is_planned"] = json!(false);
                    if p["created_at"].is_null() {
                        p["created_at"] = json!(now);
                    }
                }
                patch(&mut s, "sets", id(&op, "setId"), &p)?;
            }
            "delete_set" => rows(&mut s, "sets")?.retain(|r| id(r, "id") != id(&op, "setId")),
            "create_gym" => add(&mut s, "gyms", &op["row"])?,
            "delete_gym" => rows(&mut s, "gyms")?.retain(|r| id(r, "id") != id(&op, "id")),
            "rename_gym" => {
                let name = op["newName"].as_str().unwrap_or("").trim();
                let old = rows(&mut s, "gyms")?
                    .iter()
                    .find(|r| id(r, "id") == id(&op, "id"))
                    .and_then(|r| r["name"].as_str())
                    .map(str::to_string);
                if let Some(old) = old {
                    if !name.is_empty() {
                        let others: HashSet<_> = rows(&mut s, "gyms")?
                            .iter()
                            .filter(|r| id(r, "id") != id(&op, "id"))
                            .filter_map(|r| r["name"].as_str().map(str::to_string))
                            .collect();
                        patch(&mut s, "gyms", id(&op, "id"), &json!({"name":name}))?;
                        for w in rows(&mut s, "workouts")? {
                            let gym = w["gym"].as_str().unwrap_or("");
                            if gym == old
                                || (gym.to_lowercase() == old.to_lowercase()
                                    && !others.contains(gym))
                            {
                                w["gym"] = json!(name);
                            }
                        }
                    }
                }
            }
            "set_exercise_note" => patch(
                &mut s,
                "workout_exercises",
                id(&op, "weId"),
                &json!({"note":op["text"].as_str().unwrap_or("").trim()}),
            )?,
            "set_day_note" => {
                let date = op["date"].as_str().unwrap_or("");
                let text = op["text"].as_str().unwrap_or("").trim();
                let notes = rows(&mut s, "day_notes")?;
                notes.retain(|r| r["date"] != date);
                if !text.is_empty() {
                    notes.push(json!({"date":date,"text":text}));
                }
            }
            _ => {}
        }
    }
    if !affected.is_empty() {
        let mut typed: Snapshot = serde_json::from_value(s).map_err(invalid)?;
        prs::recompute(&mut typed, Some(&affected));
        s = serde_json::to_value(typed).map_err(invalid)?;
    }
    Ok(s)
}
