//! AI context selection and plan rules. Provider HTTP and credentials stay in
//! the host. Each accepted day is prepared atomically in Rust.
use crate::{
    commands::{apply_command, seeds, Command, Context},
    model::Snapshot,
    queries::fuzzy_match,
    units::{to_kg, WeightUnit},
};
use serde_json::{json, Value};
fn number(v: &Value) -> Option<f64> {
    let n = if let Some(n) = v.as_f64() {
        Some(n)
    } else if let Some(s) = v.as_str() {
        let s = s.trim();
        if s.is_empty() {
            Some(0.0)
        } else if s.starts_with("0x") || s.starts_with("0X") {
            u64::from_str_radix(&s[2..], 16).ok().map(|n| n as f64)
        } else if s.starts_with("0b") || s.starts_with("0B") {
            u64::from_str_radix(&s[2..], 2).ok().map(|n| n as f64)
        } else if s.starts_with("0o") || s.starts_with("0O") {
            u64::from_str_radix(&s[2..], 8).ok().map(|n| n as f64)
        } else {
            s.parse().ok()
        }
    } else {
        None
    };
    n.filter(|n| n.is_finite())
}
fn valid_date(s: &str) -> bool {
    s.len() == 10
        && s.bytes().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}
pub fn parse(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    let value = serde_json::from_str::<Value>(trimmed)
        .or_else(|_| {
            let start = trimmed.find('{');
            let end = trimmed.rfind('}');
            if let (Some(start), Some(end)) = (start, end) {
                if end > start {
                    return serde_json::from_str(&trimmed[start..=end]);
                }
            }
            serde_json::from_str("")
        })
        .map_err(|_| "AI response was not valid JSON")?;
    if !value.is_object() && !value.is_array() {
        return Err("AI response is not a JSON object".into());
    }
    let rows = value["days"]
        .as_array()
        .ok_or("AI response is missing a \"days\" array")?;
    let mut days = vec![];
    for day in rows {
        let Some(date) = day["date"].as_str().filter(|s| valid_date(s)) else {
            continue;
        };
        let mut exercises = vec![];
        for ex in day["exercises"].as_array().into_iter().flatten() {
            let Some(name) = ex["name"].as_str().map(str::trim).filter(|s| !s.is_empty()) else {
                continue;
            };
            let mut sets = vec![];
            for set in ex["sets"].as_array().into_iter().flatten() {
                if !set.is_object() && !set.is_array() {
                    continue;
                }
                let mut out = json!({"weight":number(&set["weight"]),"reps":number(&set["reps"]),"distance_m":number(&set["distance_m"]),"time_seconds":number(&set["time_seconds"])});
                if let Some(note) = set["note"].as_str() {
                    out["note"] = json!(note);
                }
                sets.push(out);
            }
            let mut out = json!({"name":name,"sets":sets});
            for key in ["category", "kind"] {
                if let Some(s) = ex[key].as_str().map(str::trim).filter(|s| !s.is_empty()) {
                    out[key] = json!(s);
                }
            }
            exercises.push(out);
        }
        days.push(json!({"date":date,"exercises":exercises}));
    }
    Ok(json!({"days":days}))
}
pub fn apply(
    snapshot: &mut Snapshot,
    plan: &Value,
    unit: WeightUnit,
    ctx: &mut Context,
) -> Result<Value, String> {
    let days = plan["days"].as_array().ok_or("Plan is missing days")?;
    let mut applied = vec![];
    let mut errors = vec![];
    for day in days {
        let Some(exercises) = day["exercises"].as_array().filter(|a| !a.is_empty()) else {
            continue;
        };
        let date = day["date"].as_str().ok_or("Plan date missing")?;
        if !valid_date(date) {
            errors.push(json!({"date":date,"message":"Invalid plan date"}));
            continue;
        }
        let mut staged = snapshot.clone();
        let mut day_ctx = ctx.clone();
        let result = (|| -> Result<(), String> {
            let workout = apply_command(
                &mut staged,
                Command::CreateWorkout { date: date.into() },
                &mut day_ctx,
            )?;
            let wid = workout["row"]["id"]
                .as_u64()
                .ok_or("Workout creation failed")?;
            for ex in exercises {
                let Some(name) = ex["name"].as_str().filter(|s| !s.is_empty()) else {
                    continue;
                };
                let mut library = seeds();
                for row in &staged.exercises {
                    if let Some(old) = library.iter_mut().find(|e| e.id == row.id) {
                        *old = row.clone();
                    } else {
                        library.push(row.clone());
                    }
                }
                library.retain(|e| e.is_deleted != Some(true) && fuzzy_match(&e.name, name));
                library.sort_by_key(|e| e.name.to_lowercase());
                let found = library
                    .iter()
                    .find(|e| e.name.to_lowercase() == name.to_lowercase())
                    .or_else(|| library.first())
                    .map(|e| e.id);
                let eid = if let Some(id) = found {
                    id
                } else {
                    let category = ex["category"]
                        .as_str()
                        .filter(|c| {
                            [
                                "abs",
                                "back",
                                "biceps",
                                "cardio",
                                "chest",
                                "legs",
                                "shoulders",
                                "triceps",
                            ]
                            .contains(c)
                        })
                        .unwrap_or("chest");
                    let kind = ex["kind"]
                        .as_str()
                        .filter(|k| {
                            [
                                "weight_reps",
                                "distance_time",
                                "bodyweight_reps",
                                "time_only",
                            ]
                            .contains(k)
                        })
                        .unwrap_or("weight_reps");
                    apply_command(
                        &mut staged,
                        Command::CreateExercise {
                            name: name.into(),
                            category: category.into(),
                            kind: Some(kind.into()),
                        },
                        &mut day_ctx,
                    )?["id"]
                        .as_u64()
                        .ok_or("Exercise creation failed")?
                };
                let we = apply_command(
                    &mut staged,
                    Command::AddExercise {
                        workout_id: wid,
                        exercise_id: eid,
                    },
                    &mut day_ctx,
                )?["id"]
                    .as_u64()
                    .ok_or("Workout exercise creation failed")?;
                for set in ex["sets"].as_array().into_iter().flatten() {
                    apply_command(
                        &mut staged,
                        Command::AddSet {
                            we_id: we,
                            input: json!({"weight":set["weight"].as_f64().map(|w|to_kg(w,unit)),"reps":set["reps"],"distance_m":set["distance_m"],"time_seconds":set["time_seconds"],"note":set["note"].as_str().unwrap_or(""),"is_planned":true}),
                        },
                        &mut day_ctx,
                    )?;
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                *snapshot = staged;
                *ctx = day_ctx;
                applied.push(date.to_string());
            }
            Err(message) => errors.push(json!({"date":date,"message":message})),
        }
    }
    Ok(json!({"appliedDates":applied,"errors":errors}))
}
