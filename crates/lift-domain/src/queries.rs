use crate::{
    commands::{seed_catalog, seeds},
    model::*,
    prs::timestamp,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Default)]
pub struct Indexes {
    pub(crate) workouts: HashMap<u64, usize>,
    /// Last workout per date, as the TypeScript date index.
    pub(crate) dates: HashMap<String, usize>,
    /// First workout per date, as `workouts.find(...)` in the mutations.
    pub(crate) first_dates: HashMap<String, usize>,
    pub(crate) exercises: HashMap<u64, usize>,
    pub(crate) wes: HashMap<u64, Vec<usize>>,
    pub(crate) by_exercise: HashMap<u64, Vec<usize>>,
    pub(crate) we_by_id: HashMap<u64, usize>,
    pub(crate) sets: HashMap<u64, Vec<usize>>,
    pub(crate) set_by_id: HashMap<u64, usize>,
}
impl Indexes {
    pub fn build(s: &Snapshot) -> Self {
        let mut indexes = Self::default();
        indexes.rebuild(s, true, true, true, true);
        indexes
    }
    pub fn update(&mut self, old: &Snapshot, new: &Snapshot) {
        self.rebuild(
            new,
            !old.workouts.shares_storage_with(&new.workouts),
            !old.exercises.shares_storage_with(&new.exercises),
            !old.workout_exercises
                .shares_storage_with(&new.workout_exercises),
            !old.sets.shares_storage_with(&new.sets),
        );
    }
    /// Maintains the indexes for a committed change. Appended rows and
    /// in-place edits are applied row by row; a table that lost rows is
    /// rebuilt, since its positions moved.
    pub fn apply(&mut self, old: &Snapshot, new: &Snapshot, changes: &crate::diff::Changes) {
        let d = &changes.workouts;
        let mut rebuild_workouts = !d.positional;
        if d.positional {
            for &p in &d.upserts {
                if p < old.workouts.len() {
                    if old.workouts[p].date != new.workouts[p].date {
                        rebuild_workouts = true;
                        break;
                    }
                } else {
                    let w = &new.workouts[p];
                    self.workouts.insert(w.id, p);
                    self.dates.insert(w.date.clone(), p);
                    self.first_dates.entry(w.date.clone()).or_insert(p);
                }
            }
        }
        let d = &changes.exercises;
        let rebuild_exercises = !d.positional;
        if d.positional {
            for &p in &d.upserts {
                if p >= old.exercises.len() {
                    self.exercises.insert(new.exercises[p].id, p);
                }
            }
        }
        let d = &changes.workout_exercises;
        let mut rebuild_wes = !d.positional;
        if d.positional {
            for &p in &d.upserts {
                if p < old.workout_exercises.len() {
                    let (a, b) = (&old.workout_exercises[p], &new.workout_exercises[p]);
                    if (a.workout_id, a.exercise_id, a.order)
                        != (b.workout_id, b.exercise_id, b.order)
                    {
                        rebuild_wes = true;
                        break;
                    }
                }
            }
            if !rebuild_wes {
                for &p in &d.upserts {
                    if p >= old.workout_exercises.len() {
                        let we = &new.workout_exercises[p];
                        let list = self.wes.entry(we.workout_id).or_default();
                        list.push(p);
                        list.sort_by_key(|i| (new.workout_exercises[*i].order, *i));
                        self.by_exercise.entry(we.exercise_id).or_default().push(p);
                        self.we_by_id.insert(we.id, p);
                    }
                }
            }
        }
        let d = &changes.sets;
        let mut rebuild_sets = !d.positional && !d.truncated;
        if d.positional || d.truncated {
            for &p in &d.upserts {
                if p < old.sets.len() {
                    let (a, b) = (&old.sets[p], &new.sets[p]);
                    if (a.workout_exercise_id, a.order) != (b.workout_exercise_id, b.order) {
                        rebuild_sets = true;
                        break;
                    }
                }
            }
            if !rebuild_sets {
                if d.truncated {
                    let mut owners = HashSet::new();
                    for key in &d.deletes {
                        let id: u64 = key.parse().expect("set diff keys are IDs");
                        if let Some(p) = self.set_by_id.remove(&id) {
                            owners.insert(old.sets[p].workout_exercise_id);
                        }
                    }
                    for owner in owners {
                        if let Some(rows) = self.sets.get_mut(&owner) {
                            rows.retain(|p| *p < new.sets.len());
                        }
                    }
                }
                for &p in &d.upserts {
                    if p >= old.sets.len() {
                        let set = &new.sets[p];
                        let list = self.sets.entry(set.workout_exercise_id).or_default();
                        list.push(p);
                        list.sort_by_key(|i| (new.sets[*i].order, *i));
                        self.set_by_id.insert(set.id, p);
                    }
                }
            }
        }
        if rebuild_workouts || rebuild_exercises || rebuild_wes || rebuild_sets {
            self.rebuild(
                new,
                rebuild_workouts,
                rebuild_exercises,
                rebuild_wes,
                rebuild_sets,
            );
        }
    }
    fn rebuild(&mut self, s: &Snapshot, workouts: bool, exercises: bool, wes: bool, sets: bool) {
        if workouts {
            self.workouts.clear();
            self.dates.clear();
            self.first_dates.clear();
            for (i, w) in s.workouts.iter().enumerate() {
                self.workouts.insert(w.id, i);
                self.dates.insert(w.date.clone(), i);
                self.first_dates.entry(w.date.clone()).or_insert(i);
            }
        }
        if exercises {
            self.exercises.clear();
            for (i, e) in s.exercises.iter().enumerate() {
                self.exercises.insert(e.id, i);
            }
        }
        if wes {
            self.wes.clear();
            self.by_exercise.clear();
            self.we_by_id.clear();
            for (i, we) in s.workout_exercises.iter().enumerate() {
                self.wes.entry(we.workout_id).or_default().push(i);
                self.by_exercise.entry(we.exercise_id).or_default().push(i);
                self.we_by_id.insert(we.id, i);
            }
            for rows in self.wes.values_mut() {
                rows.sort_by_key(|i| s.workout_exercises[*i].order);
            }
        }
        if sets {
            self.sets.clear();
            self.set_by_id.clear();
            for (i, set) in s.sets.iter().enumerate() {
                self.sets
                    .entry(set.workout_exercise_id)
                    .or_default()
                    .push(i);
                self.set_by_id.insert(set.id, i);
            }
            for rows in self.sets.values_mut() {
                rows.sort_by_key(|i| s.sets[*i].order);
            }
        }
    }
    fn exercise(&self, s: &Snapshot, id: u64) -> ExerciseRow {
        self.exercises
            .get(&id)
            .map(|i| s.exercises[*i].clone())
            .or_else(|| seed_catalog().iter().find(|e| e.id == id).cloned())
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
    pub fn workout(&self, s: &Snapshot, w: &WorkoutRow) -> Value {
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
    pub fn predict_pr(
        &self,
        s: &Snapshot,
        exercise_id: u64,
        we_id: u64,
        weight: f64,
        reps: f64,
        queued: &[Effort],
    ) -> Value {
        let logged = self
            .sets(s, we_id)
            .into_iter()
            .filter(|s| !s.is_planned && s.weight.is_some() && s.reps.is_some())
            .count();
        let position = logged + queued.len() + 1;
        let weight = crate::units::weight_key(Some(weight));
        let beats = |w: f64, r: f64| crate::units::weight_key(Some(w)) >= weight && r >= reps;
        let mut is_pr = !queued.iter().any(|q| beats(q.weight, q.reps));
        let mut is_pos_pr = true;
        for i in self.by_exercise.get(&exercise_id).into_iter().flatten() {
            let we = &s.workout_exercises[*i];
            let mut sets = self.sets(s, we.id);
            sets.sort_by_key(|s| (s.order, s.id));
            let mut pos = 0;
            for set in sets {
                if set.is_planned {
                    continue;
                }
                let (Some(w), Some(r)) = (set.weight, set.reps) else {
                    continue;
                };
                pos += 1;
                if beats(w, r) {
                    is_pr = false;
                    if pos == position {
                        is_pos_pr = false;
                    }
                }
                if !is_pr && !is_pos_pr {
                    break;
                }
            }
        }
        json!({"isPr":is_pr,"isPosPr":is_pos_pr,"position":position})
    }
    pub fn history(&self, s: &Snapshot, id: u64) -> Vec<Value> {
        self.history_page(s, id, 0, usize::MAX).1
    }
    /// Select day keys before materializing set DTOs. Paging a long history
    /// must not allocate every historical set merely to return its first page.
    pub fn history_page(
        &self,
        s: &Snapshot,
        id: u64,
        offset: usize,
        limit: usize,
    ) -> (usize, Vec<Value>) {
        let mut dates = std::collections::BTreeSet::new();
        for i in self.by_exercise.get(&id).into_iter().flatten() {
            let we = &s.workout_exercises[*i];
            let Some(w) = self.workouts.get(&we.workout_id).map(|i| &s.workouts[*i]) else {
                continue;
            };
            if w.status != "planned"
                && self
                    .sets
                    .get(&we.id)
                    .is_some_and(|rows| rows.iter().any(|i| !s.sets[*i].is_planned))
            {
                dates.insert(w.date.as_str());
            }
        }
        let total = dates.len();
        let selected: HashSet<_> = dates.into_iter().rev().skip(offset).take(limit).collect();
        let mut days: BTreeMap<String, Value> = BTreeMap::new();
        for i in self.by_exercise.get(&id).into_iter().flatten() {
            let we = &s.workout_exercises[*i];
            let Some(w) = self.workouts.get(&we.workout_id).map(|i| &s.workouts[*i]) else {
                continue;
            };
            if w.status == "planned" || !selected.contains(w.date.as_str()) {
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
        (total, days.into_values().rev().collect())
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
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Effort {
    pub weight: f64,
    pub reps: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Query {
    Workout {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
    },
    WorkoutByDate {
        date: String,
    },
    History {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
        offset: usize,
        limit: usize,
    },
    HistoryPage {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
        cursor: Option<String>,
        limit: usize,
    },
    Calendar {
        month: String,
    },
    Exercise {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        id: u64,
    },
    PlannedDates {
        month: String,
    },
    Exercises {
        sort: Option<String>,
        q: Option<String>,
        category: Option<String>,
        // Ignored: every matching exercise is returned, as listExercisesQ
        // did. Kept so existing callers still parse.
        #[serde(default)]
        #[cfg_attr(feature = "typescript", ts(optional))]
        limit: Option<usize>,
        today: String,
    },
    Chart {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
        metric: crate::stats::Metric,
        set_index: usize,
        unit: String,
    },
    Summary {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
        sort: crate::stats::RepSort,
        #[cfg_attr(feature = "typescript", ts(type = "number | null"))]
        set_number: Option<i64>,
    },
    AiHistory {
        from: String,
        to: String,
        unit: String,
        #[cfg_attr(feature = "typescript", ts(type = "number[]"))]
        exercise_ids: Vec<u64>,
    },
    PredictPr {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        exercise_id: u64,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        we_id: u64,
        weight: f64,
        reps: f64,
        queued: Vec<Effort>,
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
            let (total, items) = ix.history_page(s, exercise_id, offset, limit.min(100));
            json!({"total":total,"items":items})
        }
        Query::HistoryPage { .. } => Value::Null, // revision-bound; handled by Engine
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
        Query::AiHistory {
            from,
            to,
            unit,
            exercise_ids,
        } => {
            let filter: HashSet<_> = exercise_ids.into_iter().collect();
            let mut workouts: Vec<_> = s
                .workouts
                .iter()
                .filter(|w| w.date >= from && w.date <= to && w.status != "planned")
                .collect();
            workouts.sort_by(|a, b| b.date.cmp(&a.date));
            let mut days = vec![];
            let unit = if unit == "kg" {
                crate::units::WeightUnit::Kg
            } else {
                crate::units::WeightUnit::Lb
            };
            for w in workouts {
                let mut exercises = vec![];
                for i in ix.wes.get(&w.id).into_iter().flatten() {
                    let we = &s.workout_exercises[*i];
                    if !filter.is_empty() && !filter.contains(&we.exercise_id) {
                        continue;
                    }
                    let ex = ix.exercise(s, we.exercise_id);
                    let sets:Vec<_>=ix.sets(s,we.id).into_iter().filter(|s|!s.is_planned).map(|s|json!({"weight":s.weight.map(|w|crate::units::round_for_display(crate::units::from_kg(Some(w),unit))),"reps":s.reps,"distance_m":s.distance_m,"time_seconds":s.time_seconds})).collect();
                    if !sets.is_empty() {
                        exercises.push(json!({"name":ex.name,"category":ex.category,"kind":ex.kind,"sets":sets}));
                    }
                }
                if !exercises.is_empty() {
                    days.push(json!({"date":w.date,"exercises":exercises}));
                }
                if days.len() == 40 {
                    break;
                }
            }
            json!(days)
        }
        Query::PredictPr {
            exercise_id,
            we_id,
            weight,
            reps,
            queued,
        } => ix.predict_pr(s, exercise_id, we_id, weight, reps, &queued),
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
        Query::Exercise { id } => exercise_view(&ix.exercise(s, id)),
        Query::PlannedDates { month } => json!(s
            .workouts
            .iter()
            .filter(|w| w.status == "planned" && w.date.starts_with(&format!("{month}-")))
            .map(|w| w.date.clone())
            .collect::<Vec<_>>()),
        Query::Exercises {
            sort,
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
            let mut result: Vec<_> = all
                .into_iter()
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
            if sort.as_deref() == Some("last_performed") {
                result.sort_by(|a, b| {
                    match (
                        a["last_performed_days_ago"].as_i64(),
                        b["last_performed_days_ago"].as_i64(),
                    ) {
                        (Some(a), Some(b)) => a.cmp(&b),
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        _ => std::cmp::Ordering::Equal,
                    }
                });
            }
            let _ = limit;
            json!(result)
        }
    }
}
