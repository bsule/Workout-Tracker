use crate::{commands::seeds, model::*, prs::timestamp};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Default)]
pub struct Indexes {
    workouts: HashMap<u64, usize>,
    dates: HashMap<String, usize>,
    exercises: HashMap<u64, usize>,
    wes: HashMap<u64, Vec<usize>>,
    by_exercise: HashMap<u64, Vec<usize>>,
    sets: HashMap<u64, Vec<usize>>,
}
impl Indexes {
    pub fn build(s: &Snapshot) -> Self {
        let mut ix = Self::default();
        for (i, w) in s.workouts.iter().enumerate() {
            ix.workouts.insert(w.id, i);
            ix.dates.insert(w.date.clone(), i);
        }
        for (i, e) in s.exercises.iter().enumerate() {
            ix.exercises.insert(e.id, i);
        }
        for (i, we) in s.workout_exercises.iter().enumerate() {
            ix.wes.entry(we.workout_id).or_default().push(i);
            ix.by_exercise.entry(we.exercise_id).or_default().push(i);
        }
        for rows in ix.wes.values_mut() {
            rows.sort_by_key(|i| s.workout_exercises[*i].order);
        }
        for (i, set) in s.sets.iter().enumerate() {
            ix.sets.entry(set.workout_exercise_id).or_default().push(i);
        }
        for rows in ix.sets.values_mut() {
            rows.sort_by_key(|i| s.sets[*i].order);
        }
        ix
    }
    fn exercise(&self, s: &Snapshot, id: u64) -> ExerciseRow {
        self.exercises
            .get(&id)
            .map(|i| s.exercises[*i].clone())
            .or_else(|| seeds().into_iter().find(|e| e.id == id))
            .unwrap_or(ExerciseRow {
                id,
                name: format!("Unknown exercise (#{id})"),
                category: "chest".into(),
                kind: "weight_reps".into(),
                is_custom: true,
                is_deleted: None,
            })
    }
    fn sets<'a>(&self, s: &'a Snapshot, we: u64) -> Vec<&'a SetRow> {
        self.sets
            .get(&we)
            .into_iter()
            .flatten()
            .map(|i| &s.sets[*i])
            .collect()
    }
    fn workout(&self, s: &Snapshot, w: &WorkoutRow) -> Value {
        let exercises:Vec<_>=self.wes.get(&w.id).into_iter().flatten().map(|i|{
            let we=&s.workout_exercises[*i];
            json!({"id":we.id,"order":we.order,"note":we.note,"exercise":exercise_view(&self.exercise(s,we.exercise_id)),"sets":self.sets(s,we.id).into_iter().map(set_view).collect::<Vec<_>>()})
        }).collect();
        let duration = match (&w.started_at, &w.finished_at) {
            (Some(a), Some(b)) => Some(
                ((timestamp(b) - timestamp(a)) as f64 / 1000.0)
                    .round()
                    .max(0.0),
            ),
            _ => None,
        };
        json!({"id":w.id,"date":w.date,"status":w.status,"started_at":w.started_at,"finished_at":w.finished_at,"duration_seconds":duration,"gym":w.gym,"notes":w.notes,"created_at":w.created_at,"exercises":exercises})
    }
    pub fn history(&self, s: &Snapshot, id: u64) -> Vec<Value> {
        let mut days: BTreeMap<String, Value> = BTreeMap::new();
        for i in self.by_exercise.get(&id).into_iter().flatten() {
            let we = &s.workout_exercises[*i];
            let Some(w) = self.workouts.get(&we.workout_id).map(|i| &s.workouts[*i]) else {
                continue;
            };
            if w.status == "planned" {
                continue;
            }
            let mut sets = self.sets(s, we.id);
            sets.retain(|s| !s.is_planned);
            sets.sort_by_key(|s| (s.order, s.id));
            if sets.is_empty() {
                continue;
            }
            let mut position = 0;
            let rows: Vec<_> = sets
                .into_iter()
                .map(|s| {
                    if s.weight.is_some() && s.reps.is_some() {
                        position += 1;
                    }
                    let mut v = set_view(s);
                    let obj = v.as_object_mut().unwrap();
                    obj.remove("created_at");
                    obj.remove("is_planned");
                    obj.insert(
                        "position".into(),
                        json!(if s.weight.is_some() && s.reps.is_some() {
                            position
                        } else {
                            0
                        }),
                    );
                    obj.insert(
                        "estimated_one_rm".into(),
                        json!(estimate_one_rm(s.weight, s.reps)),
                    );
                    v
                })
                .collect();
            let day = days
                .entry(w.date.clone())
                .or_insert_with(|| json!({"date":w.date,"note":"","sets":[]}));
            day["sets"].as_array_mut().unwrap().extend(rows);
            let note = we.note.trim();
            if !note.is_empty() {
                let old = day["note"].as_str().unwrap();
                day["note"] = json!(if old.is_empty() {
                    note.to_string()
                } else {
                    format!("{old} / {note}")
                });
            }
        }
        days.into_values().rev().collect()
    }
}
fn exercise_view(e: &ExerciseRow) -> Value {
    json!({"id":e.id,"name":e.name,"category":e.category,"kind":e.kind,"is_custom":e.is_custom})
}
fn set_view(s: &SetRow) -> Value {
    let mut v = serde_json::to_value(s).unwrap();
    v.as_object_mut().unwrap().remove("workout_exercise_id");
    v
}
pub fn estimate_one_rm(weight: Option<f64>, reps: Option<f64>) -> f64 {
    let (Some(w), Some(r)) = (weight, reps) else {
        return 0.0;
    };
    if r <= 0.0 {
        return 0.0;
    }
    if r == 1.0 {
        return w;
    }
    let d = 1.0278 - 0.0278 * r;
    if d <= 0.0 {
        w
    } else {
        w / d
    }
}
pub fn fuzzy_match(text: &str, query: &str) -> bool {
    let lower = query.to_lowercase();
    let text: Vec<_> = text.to_lowercase().encode_utf16().collect();
    lower
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .all(|tok| {
            let threshold = match tok.len() {
                0..=2 => 0,
                3..=5 => 1,
                6..=8 => 2,
                _ => 3,
            };
            let mut prev = vec![0; text.len() + 1];
            let mut next = prev.clone();
            for (i, q) in tok.encode_utf16().enumerate() {
                next[0] = i + 1;
                for (j, t) in text.iter().enumerate() {
                    next[j + 1] = (prev[j] + usize::from(t != &q))
                        .min(prev[j + 1] + 1)
                        .min(next[j] + 1);
                }
                std::mem::swap(&mut prev, &mut next);
            }
            prev.into_iter().min().unwrap_or(0) <= threshold
        })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Query {
    Workout {
        id: u64,
    },
    WorkoutByDate {
        date: String,
    },
    History {
        exercise_id: u64,
        offset: usize,
        limit: usize,
    },
    Calendar {
        month: String,
    },
    Exercises {
        q: Option<String>,
        category: Option<String>,
        limit: usize,
        today: String,
    },
    Chart {
        exercise_id: u64,
        metric: crate::stats::Metric,
        set_index: usize,
        unit: String,
    },
    Summary {
        exercise_id: u64,
        sort: crate::stats::RepSort,
        set_number: Option<i64>,
    },
    Settings,
    Counts,
    DayNote {
        date: String,
    },
    Gyms,
}
pub fn query(s: &Snapshot, ix: &Indexes, q: Query) -> Value {
    match q {
        Query::Workout { id } => ix
            .workouts
            .get(&id)
            .map(|i| ix.workout(s, &s.workouts[*i]))
            .unwrap_or(Value::Null),
        Query::WorkoutByDate { date } => ix
            .dates
            .get(&date)
            .map(|i| ix.workout(s, &s.workouts[*i]))
            .unwrap_or(Value::Null),
        Query::History {
            exercise_id,
            offset,
            limit,
        } => {
            let days = ix.history(s, exercise_id);
            json!({"total":days.len(),"items":days.into_iter().skip(offset).take(limit.min(100)).collect::<Vec<_>>()})
        }
        Query::Chart {
            exercise_id,
            metric,
            set_index,
            unit,
        } => crate::stats::chart(
            &ix.history(s, exercise_id),
            metric,
            set_index,
            if unit == "kg" {
                crate::units::WeightUnit::Kg
            } else {
                crate::units::WeightUnit::Lb
            },
        ),
        Query::Summary {
            exercise_id,
            sort,
            set_number,
        } => crate::stats::records(&ix.history(s, exercise_id), sort, set_number),
        Query::Settings => s.settings.clone(),
        Query::Counts => {
            json!({"workouts":s.workouts.len(),"sets":s.sets.iter().filter(|s|!s.is_planned).count(),"exercises":s.exercises.iter().filter(|e|e.is_deleted!=Some(true)).count()})
        }
        Query::DayNote { date } => json!(s
            .day_notes
            .iter()
            .find(|n| n.date == date)
            .map(|n| n.text.as_str())
            .unwrap_or("")),
        Query::Gyms => serde_json::to_value(&s.gyms).unwrap(),
        Query::Calendar { month } => {
            let mut out = serde_json::Map::new();
            for w in &s.workouts {
                if !w.date.starts_with(&format!("{month}-")) {
                    continue;
                }
                let mut seen = HashSet::new();
                let mut cats = vec![];
                for i in ix.wes.get(&w.id).into_iter().flatten() {
                    let category = ix.exercise(s, s.workout_exercises[*i].exercise_id).category;
                    if seen.insert(category.clone()) {
                        cats.push(category);
                    }
                }
                if !cats.is_empty() || w.status == "planned" {
                    out.insert(w.date.clone(), json!(cats));
                }
            }
            Value::Object(out)
        }
        Query::Exercises {
            q,
            category,
            limit,
            today,
        } => {
            let mut all = seeds();
            for row in &s.exercises {
                if let Some(old) = all.iter_mut().find(|e| e.id == row.id) {
                    *old = row.clone();
                } else {
                    all.push(row.clone());
                }
            }
            all.retain(|e| {
                e.is_deleted != Some(true)
                    && category.as_ref().is_none_or(|c| c == &e.category)
                    && q.as_ref().is_none_or(|q| fuzzy_match(&e.name, q))
            });
            all.sort_by_key(|e| e.name.to_lowercase());
            let today = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").ok();
            let result: Vec<_> = all
                .into_iter()
                .take(limit.min(500))
                .map(|e| {
                    let mut count = 0;
                    let mut last: Option<&str> = None;
                    for i in ix.by_exercise.get(&e.id).into_iter().flatten() {
                        let we = &s.workout_exercises[*i];
                        let Some(w) = ix.workouts.get(&we.workout_id).map(|i| &s.workouts[*i])
                        else {
                            continue;
                        };
                        if w.status == "planned" || !ix.sets(s, we.id).iter().any(|s| !s.is_planned)
                        {
                            continue;
                        }
                        count += 1;
                        if last.is_none_or(|d| w.date.as_str() > d) {
                            last = Some(&w.date);
                        }
                    }
                    let days = last
                        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                        .zip(today)
                        .map(|(a, b)| (b - a).num_days().max(0));
                    let mut v = exercise_view(&e);
                    v["workouts_count"] = json!(count);
                    v["last_performed_days_ago"] = json!(days);
                    v
                })
                .collect();
            json!(result)
        }
    }
}
