use crate::{
    queries::estimate_one_rm,
    units::{from_kg, round_for_display, weight_key, WeightUnit},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    OneRm,
    Heaviest,
    AvgWeight,
    PerSet,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum RepSort {
    #[serde(rename = "weight")]
    Weight,
    #[serde(rename = "oneRm")]
    OneRm,
    #[serde(rename = "reps")]
    Reps,
    #[serde(rename = "recent")]
    Recent,
}
pub fn chart(days: &[Value], metric: Metric, set_index: usize, unit: WeightUnit) -> Value {
    let mut points = vec![];
    for day in days {
        let sets: Vec<_> = day["sets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| {
                Some((
                    s["weight"].as_f64()?,
                    s["reps"].as_f64()?,
                    s["estimated_one_rm"].as_f64()?,
                ))
            })
            .collect();
        let Some(first) = sets.first() else { continue };
        let (value, reps) = match metric {
            Metric::OneRm => {
                let best = sets
                    .iter()
                    .fold(first, |best, s| if s.2 > best.2 { s } else { best });
                (best.2, best.1)
            }
            Metric::Heaviest => {
                let best = sets
                    .iter()
                    .fold(first, |best, s| if s.0 > best.0 { s } else { best });
                (best.0, best.1)
            }
            Metric::AvgWeight => (
                sets.iter().map(|s| s.0).sum::<f64>() / sets.len() as f64,
                sets.iter().map(|s| s.1).sum(),
            ),
            Metric::PerSet => {
                let Some(target) = set_index.checked_sub(1).and_then(|i| sets.get(i)) else {
                    continue;
                };
                (target.0, target.1)
            }
        };
        let value = round_for_display(from_kg(Some(value), unit));
        if value > 0.0 {
            points.push(json!({"date":day["date"],"value":value,"reps":reps}));
        }
    }
    points.sort_by(|a, b| a["date"].as_str().cmp(&b["date"].as_str()));
    json!(points)
}
struct Row {
    reps: f64,
    weight: f64,
    date: String,
    count: usize,
    one_rm: f64,
}
pub fn records(days: &[Value], sort: RepSort, set_number: Option<i64>) -> Value {
    let mut rows: Vec<Row> = vec![];
    for day in days {
        for s in day["sets"].as_array().into_iter().flatten() {
            if set_number.is_some_and(|n| s["order"].as_i64().map(|o| o + 1) != Some(n)) {
                continue;
            }
            let (Some(weight), Some(reps)) = (s["weight"].as_f64(), s["reps"].as_f64()) else {
                continue;
            };
            if let Some(row) = rows.iter_mut().find(|r| r.reps == reps) {
                row.count += 1;
                if weight_key(Some(weight)) > weight_key(Some(row.weight)) {
                    row.weight = weight;
                    row.date = day["date"].as_str().unwrap_or("").into();
                    row.one_rm = estimate_one_rm(Some(weight), Some(reps));
                }
            } else {
                rows.push(Row {
                    reps,
                    weight,
                    date: day["date"].as_str().unwrap_or("").into(),
                    count: 1,
                    one_rm: estimate_one_rm(Some(weight), Some(reps)),
                });
            }
        }
    }
    let metric = |r: &Row| match sort {
        RepSort::Reps => r.reps,
        RepSort::OneRm => r.one_rm,
        _ => weight_key(Some(r.weight)),
    };
    rows.sort_by(|a, b| match sort {
        RepSort::Recent => b
            .date
            .cmp(&a.date)
            .then_with(|| weight_key(Some(b.weight)).total_cmp(&weight_key(Some(a.weight)))),
        _ => metric(b)
            .total_cmp(&metric(a))
            .then_with(|| b.reps.total_cmp(&a.reps)),
    });
    let max = rows.iter().map(metric).fold(0.0, f64::max);
    let top = rows
        .iter()
        .enumerate()
        .fold(None, |best: Option<usize>, (i, row)| match best {
            None => Some(i),
            Some(old)
                if row.one_rm > rows[old].one_rm
                    || (row.one_rm == rows[old].one_rm && row.reps > rows[old].reps) =>
            {
                Some(i)
            }
            _ => best,
        });
    json!(rows.iter().enumerate().map(|(i,r)|json!({"reps":r.reps,"weightKg":r.weight,"date":r.date,"count":r.count,"oneRmKg":r.one_rm,"share":if max>0.0{metric(r)/max}else{0.0},"isTopOneRm":top==Some(i)})).collect::<Vec<_>>())
}
