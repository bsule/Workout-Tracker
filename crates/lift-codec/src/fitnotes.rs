use crate::{
    invalid,
    names::{normalize, ExerciseLookup},
    CodecError,
};
use lift_domain::{commands::Context, model::*, prs, units::KG_PER_LB};
use serde_json::{json, Value};
use std::collections::HashMap;
fn number(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    s.parse::<f64>().ok().filter(|v| v.is_finite())
}
fn time(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let parts: Option<Vec<_>> = s
        .split(':')
        .map(|p| {
            if p.trim().is_empty() {
                Some(0.0)
            } else {
                number(p)
            }
        })
        .collect();
    match parts?.as_slice() {
        [s] => Some(*s),
        [m, s] => Some(m * 60.0 + s),
        [h, m, s] => Some(h * 3600.0 + m * 60.0 + s),
        _ => None,
    }
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
pub fn import(
    snap: &mut Snapshot,
    text: &str,
    replace: bool,
    ctx: &mut Context,
) -> Result<Value, CodecError> {
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(text.trim_start_matches('\u{feff}').as_bytes());
    let headers = reader.headers().map_err(invalid)?.clone();
    let empty = lift_domain::table::Table::default();
    let mut lookup = ExerciseLookup::new(if replace { &empty } else { &snap.exercises });
    let mut result = snap.clone();
    if replace {
        result.exercises.clear();
        result.workouts.clear();
        result.workout_exercises.clear();
        result.sets.clear();
    }
    let mut ids = crate::Ids::new(snap, ctx);
    let mut dates: HashMap<_, _> = result
        .workouts
        .iter()
        .map(|w| (w.date.clone(), w.id))
        .collect();
    let mut pairs: HashMap<_, _> = result
        .workout_exercises
        .iter()
        .map(|w| ((w.workout_id, w.exercise_id), w.id))
        .collect();
    let mut counts: HashMap<u64, i64> = HashMap::new();
    for set in &result.sets {
        if !set.is_planned {
            *counts.entry(set.workout_exercise_id).or_default() += 1;
        }
    }
    let mut siblings: HashMap<u64, i64> = HashMap::new();
    for we in &result.workout_exercises {
        *siblings.entry(we.workout_id).or_default() += 1;
    }
    let mut imported = 0;
    let mut errors = vec![];
    let mut created = std::collections::BTreeSet::new();
    let mut rows = 0;
    for (i, record) in reader.records().enumerate() {
        let record = record.map_err(invalid)?;
        rows += 1;
        let get = |key: &str| {
            headers
                .iter()
                .position(|h| h == key)
                .and_then(|i| record.get(i))
                .unwrap_or("")
        };
        let date = get("Date").trim();
        let name = normalize(get("Exercise"));
        let fail = if date.is_empty() || name.is_empty() {
            Some("Missing date or exercise.".into())
        } else if !date_shape(date) {
            Some(format!("Bad date \"{date}\"."))
        } else if date > ctx.today.as_str() {
            Some(format!("Future date \"{date}\" skipped."))
        } else {
            None
        };
        if let Some(message) = fail {
            errors.push(json!({"row":i+2,"message":message}));
            continue;
        }
        let stated = match get("Kind").trim().to_lowercase().as_str() {
            "wr" => Some("weight_reps"),
            "dt" => Some("distance_time"),
            "br" => Some("bodyweight_reps"),
            "t" => Some("time_only"),
            _ => None,
        };
        let weight = number(get("Weight (kg)")).filter(|w| *w > 0.0).or_else(|| {
            number(get("Weight (lbs)"))
                .filter(|w| *w > 0.0)
                .map(|w| w * KG_PER_LB)
        });
        let reps = number(get("Reps")).map(f64::trunc).filter(|r| *r > 0.0);
        if let Some(reps) = reps {
            if reps > 100.0 {
                errors.push(json!({"row":i+2,"message":format!("Reps {reps} exceeds max 100 (likely typo). ").trim_end()}));
                continue;
            }
        }
        let distance = number(get("Distance")).filter(|v| *v > 0.0);
        let unit = get("Distance Unit").trim().to_lowercase();
        let distance = if let Some(d) = distance {
            let scale = match unit.as_str() {
                "mi" => 1609.344,
                "km" => 1000.0,
                "ft" => 0.3048,
                "m" => 1.0,
                _ => {
                    errors.push(
                        json!({"row":i+2,"message":format!("Unknown distance unit \"{unit}\".")}),
                    );
                    continue;
                }
            };
            Some(d * scale)
        } else {
            None
        };
        let seconds = time(get("Time"));
        if reps.is_none() && seconds.is_none() && distance.is_none() {
            errors.push(json!({"row":i+2,"message":"Row has no reps, time, or distance."}));
            continue;
        }
        let exercise = if let Some(e) = lookup.find(&name, stated) {
            e.clone()
        } else {
            let category = get("Category").trim().to_lowercase();
            let row = ExerciseRow {
                id: ids.exercise(),
                name: name.clone(),
                category: if category.is_empty() {
                    "chest".into()
                } else {
                    category
                },
                kind: stated.unwrap_or("weight_reps").into(),
                is_custom: true,
                is_deleted: None,
            };
            lookup.add(row.clone());
            result.exercises.push(row.clone());
            created.insert(name);
            row
        };
        let workout = if let Some(id) = dates.get(date) {
            *id
        } else {
            let id = ids.next();
            let active = date == ctx.today;
            result.workouts.push(WorkoutRow {
                id,
                date: date.into(),
                status: if active { "active" } else { "done" }.into(),
                started_at: if active { Some(ctx.now.clone()) } else { None },
                finished_at: None,
                gym: String::new(),
                notes: String::new(),
                created_at: ctx.now.clone(),
            });
            dates.insert(date.into(), id);
            id
        };
        let we = if let Some(id) = pairs.get(&(workout, exercise.id)) {
            *id
        } else {
            let id = ids.next();
            let order = siblings.entry(workout).or_default();
            result.workout_exercises.push(WorkoutExerciseRow {
                id,
                workout_id: workout,
                exercise_id: exercise.id,
                order: *order,
                note: String::new(),
            });
            *order += 1;
            pairs.insert((workout, exercise.id), id);
            id
        };
        let order = counts.entry(we).or_default();
        result.sets.push(SetRow {
            id: ids.next(),
            workout_exercise_id: we,
            weight,
            reps,
            distance_m: distance,
            distance_unit_display: if distance.is_some() {
                unit
            } else {
                String::new()
            },
            time_seconds: seconds,
            is_planned: false,
            is_pr: false,
            was_pr: false,
            is_position_pr: false,
            was_position_pr: false,
            note: get("Notes").trim().into(),
            order: *order,
            created_at: ctx.now.clone(),
        });
        *order += 1;
        imported += 1;
    }
    if replace && rows > 0 && imported == 0 {
        // Every row was rejected: most likely the wrong file. TypeScript
        // would have cleared the account here; nothing is replaced instead.
        // An empty file still clears it, as before.
        return Err(invalid(
            "No row in this file could be imported, so nothing was replaced.",
        ));
    }
    if imported > 0 {
        prs::recompute(&mut result, None);
    }
    lift_domain::model::repair(&mut result);
    lift_domain::model::validate(&result).map_err(invalid)?;
    *snap = result;
    ctx.next_id = ids.end();
    Ok(json!({"imported":imported,"exercisesCreated":created,"errors":errors}))
}
