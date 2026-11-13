//! User JSON export (distinct from the compressed internal sync snapshot).
use lift_domain::{commands::seeds, model::Snapshot};
use serde_json::{json, Value};
use std::collections::HashMap;

pub fn user_json(s: &Snapshot, username: &str, now: &str) -> Value {
    let mut exercises: HashMap<_, _> = seeds().into_iter().map(|e| (e.id, e)).collect();
    for e in &s.exercises {
        exercises.insert(e.id, e.clone());
    }
    let mut wes: HashMap<_, Vec<_>> = HashMap::new();
    for we in &s.workout_exercises {
        wes.entry(we.workout_id).or_default().push(we);
    }
    let mut sets: HashMap<_, Vec<_>> = HashMap::new();
    for set in &s.sets {
        if !set.is_planned {
            sets.entry(set.workout_exercise_id).or_default().push(set);
        }
    }
    let custom_ids: std::collections::HashSet<u64> = s.exercises.iter().map(|e| e.id).collect();
    let mut workouts: Vec<_> = s.workouts.iter().collect();
    workouts.sort_by_key(|w| (&w.date, w.id));
    let workouts:Vec<_>=workouts.into_iter().map(|w|{
        let mut rows=wes.get(&w.id).cloned().unwrap_or_default();rows.sort_by_key(|we|(we.order,we.id));
        let rows:Vec<_>=rows.into_iter().map(|we|{
            let ex=exercises.get(&we.exercise_id);let fallback=format!("#{}",we.exercise_id);
            let mut rows=sets.get(&we.id).cloned().unwrap_or_default();rows.sort_by_key(|s|(s.order,s.id));
            let rows:Vec<_>=rows.into_iter().map(|s|json!({"weight_kg":s.weight,"reps":s.reps,"distance_m":s.distance_m,"distance_unit_display":s.distance_unit_display,"time_seconds":s.time_seconds,"is_pr":s.is_pr,"was_pr":s.was_pr,"note":s.note,"order":s.order,"created_at":s.created_at})).collect();
            json!({"order":we.order,"note":we.note,"exercise":{"name":ex.map(|e|e.name.as_str()).unwrap_or(&fallback),"category":ex.map(|e|e.category.as_str()).unwrap_or(""),"kind":ex.map(|e|e.kind.as_str()).unwrap_or("weight_reps"),"is_custom":custom_ids.contains(&we.exercise_id)},"sets":rows})
        }).collect();
        json!({"id":w.id,"date":w.date,"started_at":w.started_at,"finished_at":w.finished_at,"gym":w.gym,"notes":w.notes,"exercises":rows})
    }).collect();
    let mut custom: Vec<_> = s.exercises.iter().filter(|e| e.is_custom).collect();
    custom.sort_by_key(|e| &e.name);
    let custom: Vec<_> = custom
        .into_iter()
        .map(|e| json!({"name":e.name,"category":e.category,"kind":e.kind}))
        .collect();
    let mut gyms: Vec<_> = s.gyms.iter().map(|g| &g.name).collect();
    gyms.sort();
    let mut notes: Vec<_> = s
        .day_notes
        .iter()
        .filter(|n| !n.text.trim().is_empty())
        .collect();
    notes.sort_by_key(|n| &n.date);
    json!({"version":2,"exported_at":now,"weight_unit":"kg","user":{"username":username},"custom_exercises":custom,"saved_gyms":gyms,"day_notes":notes,"workouts":workouts})
}
