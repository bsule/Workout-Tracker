//! Versioned user JSON import. Work is prepared in isolation; malformed input
//! never clears the committed store. The host persists the result atomically.
use crate::{
    invalid,
    names::{self, normalize, ExerciseLookup},
    set_values_key, CodecError,
};
use lift_domain::{commands::Context, model::*, prs};
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
    v.as_str().map(str::trim).filter(|s| {
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
fn row_values(s: &SetRow) -> String {
    set_values_key(s.weight, s.reps, s.distance_m, s.time_seconds)
}
fn file_values(s: &Value) -> String {
    set_values_key(
        s["weight_kg"].as_f64(),
        s["reps"].as_f64(),
        s["distance_m"].as_f64(),
        s["time_seconds"].as_f64(),
    )
}
fn new_exercise(v: &Value, id: u64, name: String, force_custom: bool) -> ExerciseRow {
    let category = text(&v["category"]).trim().to_lowercase();
    let default_kind = lift_domain::commands::default_kind_for_category(&category);
    ExerciseRow {
        id,
        name,
        category: if category.is_empty() {
            "chest".into()
        } else {
            category
        },
        // A file that states no kind gets the same default as a new
        // exercise: cardio is distance_time, so it takes no PR stars.
        kind: kind(&v["kind"]).unwrap_or(default_kind).into(),
        is_custom: force_custom || v["is_custom"] != false,
        is_deleted: None,
    }
}
/// Set orders on one exercise row. Planned and logged sets share the order
/// space: the device's orders, the ones this import added, and the highest.
struct Orders {
    device: HashSet<i64>,
    added: HashSet<i64>,
    max: i64,
}
impl Orders {
    fn new() -> Self {
        Self {
            device: HashSet::new(),
            added: HashSet::new(),
            max: -1,
        }
    }
    fn add(&mut self, order: i64) {
        self.added.insert(order);
        self.max = self.max.max(order);
    }
}
fn planned_set(s: &Value, id: u64, weid: u64, order: i64, now: &str) -> SetRow {
    SetRow {
        id,
        workout_exercise_id: weid,
        weight: s["weight_kg"].as_f64(),
        reps: s["reps"].as_f64(),
        distance_m: s["distance_m"].as_f64(),
        distance_unit_display: text(&s["distance_unit_display"]),
        time_seconds: s["time_seconds"].as_f64(),
        is_planned: true,
        is_pr: false,
        was_pr: false,
        is_position_pr: false,
        was_position_pr: false,
        note: text(&s["note"]),
        order,
        created_at: s["created_at"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(now)
            .into(),
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
    let mut ids = crate::Ids::new(snapshot, ctx);
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
    let mut siblings: HashMap<u64, i64> = HashMap::new();
    for we in &result.workout_exercises {
        *siblings.entry(we.workout_id).or_default() += 1;
    }
    let mut counts: HashMap<u64, i64> = HashMap::new();
    let mut max_order: HashMap<u64, i64> = HashMap::new();
    let mut local: HashMap<u64, HashMap<String, usize>> = HashMap::new();
    let mut orders: HashMap<u64, Orders> = HashMap::new();
    let mut planned_local: HashMap<u64, HashMap<String, usize>> = HashMap::new();
    for s in &result.sets {
        let o = orders
            .entry(s.workout_exercise_id)
            .or_insert_with(Orders::new);
        o.device.insert(s.order);
        o.max = o.max.max(s.order);
        if s.is_planned {
            *planned_local
                .entry(s.workout_exercise_id)
                .or_default()
                .entry(row_values(s))
                .or_default() += 1;
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
    // `(data.version ?? 1) >= 2`, with JavaScript's number coercion.
    let session_notes = match &data["version"] {
        Value::Null => 1.0,
        v => crate::js_number(v),
    } >= 2.0;
    let mut note_dates: HashSet<String> = result.day_notes.iter().map(|n| n.date.clone()).collect();
    for n in data["day_notes"].as_array().into_iter().flatten() {
        if let Some(date) = n["date"].as_str() {
            let note = if n["text"].is_null() {
                text(&n["notes"])
            } else {
                text(&n["text"])
            };
            let note = note.trim();
            if date_shape(date) && !note.is_empty() && note_dates.insert(date.to_string()) {
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
                    id: ids.next(),
                    name: name.into(),
                });
            }
        }
    }
    // Live custom exercises first, so a deleted row never stands in for a
    // live one of the same name.
    let declared: Vec<_> = data["custom_exercises"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| e["name"].as_str().map(|n| (e, normalize(n))))
        .filter(|(_, n)| !n.is_empty())
        .collect();
    for (e, name) in &declared {
        if e["is_deleted"] == true {
            continue;
        }
        if lookup.find(name, kind(&e["kind"])).is_none() {
            let row = new_exercise(e, ids.exercise(), name.clone(), true);
            lookup.add(row.clone());
            result.exercises.push(row);
            created.insert(name.clone());
        }
    }
    // A deleted custom exercise stays deleted: restored as a deleted row (its
    // sets stay hidden), or the device's own deleted row is reused. A live
    // exercise with the name is left alone and nothing is added.
    let mut device_deleted: HashMap<String, ExerciseRow> = HashMap::new();
    for e in &result.exercises {
        if e.is_deleted == Some(true) && e.is_custom {
            device_deleted
                .entry(names::key(&e.name))
                .or_insert_with(|| e.clone());
        }
    }
    for (e, name) in &declared {
        if e["is_deleted"] != true || lookup.find(name, kind(&e["kind"])).is_some() {
            continue;
        }
        if let Some(existing) = device_deleted.get(&names::key(name)) {
            lookup.add(existing.clone());
            continue;
        }
        let mut row = new_exercise(e, ids.exercise(), name.clone(), true);
        row.is_deleted = Some(true);
        lookup.add(row.clone());
        result.exercises.push(row);
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
        if !session_notes && !note.is_empty() && note_dates.insert(date.to_string()) {
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
            let id = ids.next();
            let index = result.workouts.len();
            result.workouts.push(WorkoutRow {
                id,
                date: date.into(),
                // The file's status when it states one; older files derive it.
                status: if let Some(status) = w["status"]
                    .as_str()
                    .filter(|s| ["planned", "active", "done"].contains(s))
                {
                    status
                } else if crate::truthy(&w["finished_at"]) {
                    "done"
                } else if crate::truthy(&w["started_at"]) {
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
                let row = new_exercise(&we["exercise"], ids.exercise(), name.clone(), false);
                lookup.add(row.clone());
                result.exercises.push(row.clone());
                created.insert(name);
                row
            };
            let weid = if let Some(id) = pairs.get(&(wid, ex.id)) {
                *id
            } else {
                let id = ids.next();
                let siblings = siblings.entry(wid).or_insert(0);
                let order = we["order"].as_i64().unwrap_or(*siblings);
                *siblings += 1;
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
                // `if (!s) continue`: every falsy entry is skipped.
                if !crate::truthy(s) {
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
                orders.entry(weid).or_insert_with(Orders::new).add(order);
                *counts.entry(weid).or_default() += 1;
                result.sets.push(SetRow {
                    id: ids.next(),
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
            // Planned sets, after the logged ones (`planned_sets`, which an
            // older importer ignores). The same session restores them by
            // position and skips a position the device already fills; another
            // session, or a set with no position, skips a planned set the
            // device has with the same values and puts the rest after every
            // set there.
            for s in we["planned_sets"].as_array().into_iter().flatten() {
                if !crate::truthy(s) {
                    continue;
                }
                let o = orders.entry(weid).or_insert_with(Orders::new);
                let position = s["order"].as_i64().filter(|_| same_session || !append);
                let order = if let Some(order) = position {
                    if o.device.contains(&order) {
                        continue;
                    }
                    if o.added.contains(&order) {
                        o.max + 1
                    } else {
                        order
                    }
                } else {
                    let values = planned_local.entry(weid).or_default();
                    if let Some(left) = values.get_mut(&file_values(s)) {
                        if *left > 0 {
                            *left -= 1;
                            continue;
                        }
                    }
                    o.max + 1
                };
                o.add(order);
                result
                    .sets
                    .push(planned_set(s, ids.next(), weid, order, &ctx.now));
            }
        }
    }
    if imported > 0 || !created.is_empty() {
        prs::recompute(&mut result, None);
    }
    lift_domain::model::repair(&mut result);
    lift_domain::model::validate(&result).map_err(invalid)?;
    *snapshot = result;
    ctx.next_id = ids.end();
    Ok(json!({"imported":imported,"exercisesCreated":created,"errors":errors}))
}
