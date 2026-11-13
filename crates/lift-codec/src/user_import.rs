//! Versioned user JSON import. Work is prepared in isolation; malformed input
//! never clears the committed store. The host persists the result atomically.
use crate::{
    invalid,
    names::{normalize, ExerciseLookup},
    CodecError,
};
use lift_domain::{commands::Context, model::*, prs, units::weight_key};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
fn text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}
fn kind(v: &Value) -> Option<&str> {
    v.as_str().filter(|s| {
        [
            "weight_reps",
            "distance_time",
            "bodyweight_reps",
            "time_only",
        ]
        .contains(s)
    })
}
fn date_shape(s: &str) -> bool {
    s.len() == 10
        && s.bytes().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}
fn values(w: Option<f64>, r: Option<f64>, d: Option<f64>, t: Option<f64>) -> String {
    let n = |v: Option<f64>| v.map(|v| v.to_string()).unwrap_or_else(|| "-".into());
    format!(
        "{}|{}|{}|{}",
        n(w.map(|v| weight_key(Some(v)))),
        n(r),
        n(d),
        n(t)
    )
}
fn row_values(s: &SetRow) -> String {
    values(s.weight, s.reps, s.distance_m, s.time_seconds)
}
fn file_values(s: &Value) -> String {
    values(
        s["weight_kg"].as_f64(),
        s["reps"].as_f64(),
        s["distance_m"].as_f64(),
        s["time_seconds"].as_f64(),
    )
}
fn new_exercise(v: &Value, id: u64, name: String, force_custom: bool) -> ExerciseRow {
    let category = text(&v["category"]).trim().to_lowercase();
    ExerciseRow {
        id,
        name,
        category: if category.is_empty() {
            "chest".into()
        } else {
            category
        },
        kind: kind(&v["kind"]).unwrap_or("weight_reps").into(),
        is_custom: force_custom || v["is_custom"] != false,
        is_deleted: None,
    }
}
pub fn import(
    snapshot: &mut Snapshot,
    input: &str,
    replace: bool,
    ctx: &mut Context,
) -> Result<Value, CodecError> {
    let data: Value = serde_json::from_str(input).map_err(invalid)?;
    let workouts = data["workouts"]
        .as_array()
        .ok_or_else(|| invalid("File is not a valid JSON snapshot."))?;
    let mut next = ctx.next_id.max(
        snapshot
            .exercises
            .iter()
            .map(|r| r.id)
            .chain(snapshot.workouts.iter().map(|r| r.id))
            .chain(snapshot.workout_exercises.iter().map(|r| r.id))
            .chain(snapshot.sets.iter().map(|r| r.id))
            .chain(snapshot.gyms.iter().map(|r| r.id))
            .max()
            .unwrap_or(0)
            + 1,
    );
    let mut alloc = || {
        let n = next;
        next += 1;
        n
    };
    let mut result = snapshot.clone();
    if replace {
        result.exercises.clear();
        result.workouts.clear();
        result.workout_exercises.clear();
        result.sets.clear();
        result.day_notes.clear();
    }
    let mut lookup = ExerciseLookup::new(&result.exercises);
    let mut dates = HashMap::new();
    for (i, w) in result.workouts.iter().enumerate() {
        dates.entry(w.date.clone()).or_insert(i);
    }
    let mut pairs: HashMap<_, _> = result
        .workout_exercises
        .iter()
        .map(|w| ((w.workout_id, w.exercise_id), w.id))
        .collect();
    let mut gyms: HashMap<_, _> = result
        .gyms
        .iter()
        .map(|g| (g.name.to_lowercase(), g.name.clone()))
        .collect();
    let mut existing: HashSet<_> = result
        .sets
        .iter()
        .filter(|s| !s.is_planned)
        .map(|s| (s.workout_exercise_id, s.order))
        .collect();
    let mut counts: HashMap<u64, i64> = HashMap::new();
    let mut max_order: HashMap<u64, i64> = HashMap::new();
    let mut local: HashMap<u64, HashMap<String, usize>> = HashMap::new();
    for s in &result.sets {
        if s.is_planned {
            continue;
        }
        *counts.entry(s.workout_exercise_id).or_default() += 1;
        max_order
            .entry(s.workout_exercise_id)
            .and_modify(|m| *m = (*m).max(s.order))
            .or_insert(s.order);
        *local
            .entry(s.workout_exercise_id)
            .or_default()
            .entry(row_values(s))
            .or_default() += 1;
    }
    let mut created_dates = HashSet::new();
    let mut seen_entries = HashSet::new();
    let mut created = BTreeSet::new();
    let mut errors = vec![];
    let mut imported = 0;
    let session_notes = data["version"].as_u64().unwrap_or(1) >= 2;
    for n in data["day_notes"].as_array().into_iter().flatten() {
        if let Some(date) = n["date"].as_str() {
            let note = if n["text"].is_null() {
                text(&n["notes"])
            } else {
                text(&n["text"])
            };
            let note = note.trim();
            if date_shape(date)
                && !note.is_empty()
                && !result.day_notes.iter().any(|n| n.date == date)
            {
                result.day_notes.push(DayNoteRow {
                    date: date.into(),
                    text: note.into(),
                });
            }
        }
    }
    for g in data["saved_gyms"].as_array().into_iter().flatten() {
        if let Some(name) = g.as_str() {
            let name = name.trim();
            if !name.is_empty() && !gyms.contains_key(&name.to_lowercase()) {
                gyms.insert(name.to_lowercase(), name.into());
                result.gyms.push(GymRow {
                    id: alloc(),
                    name: name.into(),
                });
            }
        }
    }
    for e in data["custom_exercises"].as_array().into_iter().flatten() {
        if let Some(name) = e["name"].as_str() {
            let name = normalize(name);
            if !name.is_empty() && lookup.find(&name, kind(&e["kind"])).is_none() {
                let row = new_exercise(e, alloc(), name.clone(), true);
                lookup.add(row.clone());
                result.exercises.push(row);
                created.insert(name);
            }
        }
    }
    for (wi, w) in workouts.iter().enumerate() {
        let Some(date) = w["date"].as_str() else {
            errors.push(json!({"row":wi+1,"message":"Workout missing date."}));
            continue;
        };
        if !date_shape(date) {
            errors.push(json!({"row":wi+1,"message":format!("Bad workout date \"{date}\".")}));
            continue;
        }
        let note = text(&w["notes"]);
        let note = note.trim();
        if !session_notes && !note.is_empty() && !result.day_notes.iter().any(|n| n.date == date) {
            result.day_notes.push(DayNoteRow {
                date: date.into(),
                text: note.into(),
            });
        }
        let gym = text(&w["gym"]);
        let gym = gyms.get(&gym.trim().to_lowercase()).cloned().unwrap_or(gym);
        let same_session = dates.get(date).is_some_and(|i| {
            !created_dates.contains(&result.workouts[*i].id)
                && result.workouts[*i].gym.to_lowercase() == gym.to_lowercase()
        });
        let index = if let Some(i) = dates.get(date) {
            let i = *i;
            let row = &mut result.workouts[i];
            if created_dates.contains(&row.id) {
                if row.gym.is_empty() && !gym.is_empty() {
                    row.gym = gym.clone();
                }
                if session_notes && !note.is_empty() && !row.notes.split("\n\n").any(|s| s == note)
                {
                    if !row.notes.is_empty() {
                        row.notes.push_str("\n\n");
                    }
                    row.notes.push_str(note);
                }
            }
            i
        } else {
            let id = alloc();
            let index = result.workouts.len();
            result.workouts.push(WorkoutRow {
                id,
                date: date.into(),
                status: if !w["finished_at"].is_null() {
                    "done"
                } else if !w["started_at"].is_null() {
                    "active"
                } else {
                    "done"
                }
                .into(),
                started_at: w["started_at"].as_str().map(str::to_string),
                finished_at: w["finished_at"].as_str().map(str::to_string),
                gym,
                notes: if session_notes {
                    note.into()
                } else {
                    String::new()
                },
                created_at: ctx.now.clone(),
            });
            dates.insert(date.into(), index);
            created_dates.insert(id);
            index
        };
        let wid = result.workouts[index].id;
        for we in w["exercises"].as_array().into_iter().flatten() {
            let Some(name) = we["exercise"]["name"].as_str() else {
                errors.push(json!({"row":wi+1,"message":"Workout exercise missing name."}));
                continue;
            };
            let name = normalize(name);
            if name.is_empty() {
                continue;
            }
            let ex = if let Some(ex) = lookup.find(&name, kind(&we["exercise"]["kind"])) {
                ex.clone()
            } else {
                let row = new_exercise(&we["exercise"], alloc(), name.clone(), false);
                lookup.add(row.clone());
                result.exercises.push(row.clone());
                created.insert(name);
                row
            };
            let weid = if let Some(id) = pairs.get(&(wid, ex.id)) {
                *id
            } else {
                let id = alloc();
                let order = we["order"].as_i64().unwrap_or_else(|| {
                    result
                        .workout_exercises
                        .iter()
                        .filter(|we| we.workout_id == wid)
                        .count() as i64
                });
                result.workout_exercises.push(WorkoutExerciseRow {
                    id,
                    workout_id: wid,
                    exercise_id: ex.id,
                    order,
                    note: we["note"].as_str().unwrap_or("").trim().into(),
                });
                pairs.insert((wid, ex.id), id);
                id
            };
            let append = !same_session
                && (seen_entries.contains(&weid)
                    || local.get(&weid).is_some_and(|m| !m.is_empty()));
            seen_entries.insert(weid);
            for s in we["sets"].as_array().into_iter().flatten() {
                if s.is_null() {
                    continue;
                }
                let order = if same_session || !append {
                    let order = s["order"]
                        .as_i64()
                        .unwrap_or(*counts.get(&weid).unwrap_or(&0));
                    if !replace && existing.contains(&(weid, order)) {
                        continue;
                    }
                    existing.insert((weid, order));
                    order
                } else {
                    let values = local.entry(weid).or_default();
                    let key = file_values(s);
                    if let Some(left) = values.get_mut(&key) {
                        if *left > 0 {
                            *left -= 1;
                            continue;
                        }
                    }
                    let order = max_order.get(&weid).copied().unwrap_or(-1) + 1;
                    existing.insert((weid, order));
                    order
                };
                max_order
                    .entry(weid)
                    .and_modify(|m| *m = (*m).max(order))
                    .or_insert(order);
                *counts.entry(weid).or_default() += 1;
                result.sets.push(SetRow {
                    id: alloc(),
                    workout_exercise_id: weid,
                    weight: s["weight_kg"].as_f64(),
                    reps: s["reps"].as_f64(),
                    distance_m: s["distance_m"].as_f64(),
                    distance_unit_display: text(&s["distance_unit_display"]),
                    time_seconds: s["time_seconds"].as_f64(),
                    is_planned: false,
                    is_pr: s["is_pr"].as_bool().unwrap_or(false),
                    was_pr: s["was_pr"].as_bool().unwrap_or(false),
                    is_position_pr: false,
                    was_position_pr: false,
                    note: text(&s["note"]),
                    order,
                    created_at: s["created_at"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .unwrap_or(&ctx.now)
                        .into(),
                });
                imported += 1;
            }
        }
    }
    if imported > 0 || !created.is_empty() {
        prs::recompute(&mut result, None);
    }
    lift_domain::model::validate(&result).map_err(invalid)?;
    *snapshot = result;
    ctx.next_id = next;
    Ok(json!({"imported":imported,"exercisesCreated":created,"errors":errors}))
}
