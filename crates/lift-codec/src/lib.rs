//! Legacy cloud snapshot compatibility. Local database versions are independent.
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use lift_domain::{model::*, table::Table};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufWriter, Read};

#[derive(Debug)]
pub enum CodecError {
    TooNew(u64),
    Invalid(String),
    TooLarge,
}
impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooNew(v) => write!(f, "Unsupported snapshot schema {v}"),
            Self::Invalid(s) => write!(f, "{s}"),
            Self::TooLarge => write!(f, "Snapshot exceeds expansion limit"),
        }
    }
}
impl std::error::Error for CodecError {}
fn invalid(e: impl std::fmt::Display) -> CodecError {
    CodecError::Invalid(e.to_string())
}

fn gunzip(bytes: &[u8], max_expanded: usize) -> Result<Vec<u8>, CodecError> {
    let mut raw = Vec::with_capacity(bytes.len().saturating_mul(6).min(max_expanded));
    GzDecoder::new(bytes)
        .take((max_expanded as u64).saturating_add(1))
        .read_to_end(&mut raw)
        .map_err(invalid)?;
    if raw.len() > max_expanded {
        return Err(CodecError::TooLarge);
    }
    Ok(raw)
}
/// Gzipped snapshot JSON to a migrated JSON value. Prefer `decode_snapshot`.
pub fn decode(bytes: &[u8], max_expanded: usize) -> Result<(Value, bool), CodecError> {
    let raw = gunzip(bytes, max_expanded)?;
    migrate(serde_json::from_slice(&raw).map_err(invalid)?)
}
/// Gzipped snapshot to a typed snapshot, with whether it was migrated. A
/// current-version snapshot is read straight into rows; only an older one
/// goes through the JSON migration.
pub fn decode_snapshot(bytes: &[u8], max_expanded: usize) -> Result<(Snapshot, bool), CodecError> {
    let raw = gunzip(bytes, max_expanded)?;
    parse_snapshot(&raw)
}
/// Uncompressed snapshot JSON to a typed snapshot, with whether it migrated.
pub fn parse_snapshot(raw: &[u8]) -> Result<(Snapshot, bool), CodecError> {
    if let Ok(snapshot) = serde_json::from_slice::<Snapshot>(raw) {
        match snapshot.schema_version.cmp(&SCHEMA_VERSION) {
            std::cmp::Ordering::Equal => return Ok((snapshot, false)),
            std::cmp::Ordering::Greater => {
                return Err(CodecError::TooNew(snapshot.schema_version.into()))
            }
            std::cmp::Ordering::Less => {}
        }
    }
    let (value, migrated) = migrate(serde_json::from_slice(raw).map_err(invalid)?)?;
    let snapshot = serde_json::from_value(value).map_err(invalid)?;
    Ok((snapshot, migrated))
}
/// The stamped wire form of a snapshot, borrowed: the same key order as the
/// TypeScript `{...snap, schema_version, exported_at}`.
#[derive(Serialize)]
struct Stamped<'a> {
    schema_version: u32,
    exported_at: &'a str,
    device_id: &'a str,
    settings: &'a Value,
    exercises: &'a Table<ExerciseRow>,
    workouts: &'a Table<WorkoutRow>,
    workout_exercises: &'a Table<WorkoutExerciseRow>,
    sets: &'a Table<SetRow>,
    gyms: &'a Table<GymRow>,
    day_notes: &'a Table<DayNoteRow>,
}
fn gzip_json(value: &impl Serialize) -> Result<Vec<u8>, CodecError> {
    let gzip = GzEncoder::new(Vec::new(), Compression::new(GZIP_LEVEL));
    let mut writer = BufWriter::with_capacity(64 * 1024, gzip);
    serde_json::to_writer(&mut writer, value).map_err(invalid)?;
    let gzip = writer.into_inner().map_err(|e| invalid(e.error()))?;
    gzip.finish().map_err(invalid)
}
/// Gzip level for snapshots and restore points. See `encode_level_sizes`.
pub const GZIP_LEVEL: u32 = 6;
/// Typed snapshot to the gzipped wire form the TypeScript `parse` reads.
pub fn encode_snapshot(s: &Snapshot, now: &str) -> Result<Vec<u8>, CodecError> {
    gzip_json(&Stamped {
        schema_version: SCHEMA_VERSION,
        exported_at: now,
        device_id: &s.device_id,
        settings: &s.settings,
        exercises: &s.exercises,
        workouts: &s.workouts,
        workout_exercises: &s.workout_exercises,
        sets: &s.sets,
        gyms: &s.gyms,
        day_notes: &s.day_notes,
    })
}
pub fn encode(snapshot: &Value, now: &str) -> Result<Vec<u8>, CodecError> {
    let mut stamped = snapshot.clone();
    let obj = stamped
        .as_object_mut()
        .ok_or_else(|| invalid("Snapshot must be an object"))?;
    obj.insert("schema_version".into(), json!(SCHEMA_VERSION));
    obj.insert("exported_at".into(), json!(now));
    gzip_json(&stamped)
}
fn rows<'a>(snap: &'a mut Value, key: &str) -> Result<&'a mut Vec<Value>, CodecError> {
    snap.get_mut(key)
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid(format!("Missing table {key}")))
}
fn default(row: &mut Value, key: &str, value: Value) {
    if row.get(key).is_none_or(Value::is_null) {
        row[key] = value;
    }
}
pub fn migrate(mut snap: Value) -> Result<(Value, bool), CodecError> {
    let v = match snap.get("schema_version") {
        None | Some(Value::Null) => 0,
        Some(value) => value
            .as_u64()
            .ok_or_else(|| invalid("Invalid schema version"))?,
    };
    if v > SCHEMA_VERSION as u64 {
        return Err(CodecError::TooNew(v));
    }
    if !snap.is_object() {
        return Err(invalid("Snapshot must be an object"));
    }
    for key in ["exercises", "workouts", "workout_exercises", "sets", "gyms"] {
        if !snap.get(key).is_some_and(Value::is_array) {
            return Err(invalid(format!("Invalid table {key}")));
        }
        if snap[key]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| !row.is_object())
        {
            return Err(invalid(format!("Invalid row in {key}")));
        }
    }
    if v < 2 {
        for e in rows(&mut snap, "exercises")? {
            let kind = if e["category"] == "cardio" {
                "distance_time"
            } else {
                "weight_reps"
            };
            default(e, "kind", json!(kind));
        }
        for s in rows(&mut snap, "sets")? {
            default(s, "distance_m", Value::Null);
            default(s, "distance_unit_display", json!(""));
            default(s, "time_seconds", Value::Null);
        }
    }
    if v < 4 {
        for s in rows(&mut snap, "sets")? {
            default(s, "is_position_pr", json!(false));
            default(s, "was_position_pr", json!(false));
        }
    }
    if v < 5 {
        let mut notes = serde_json::Map::new();
        if let Some(existing) = snap["day_notes"].as_array() {
            for n in existing {
                if let Some(date) = n["date"].as_str() {
                    notes.insert(date.into(), n["text"].clone());
                }
            }
        }
        for w in rows(&mut snap, "workouts")? {
            let note = w["notes"].as_str().unwrap_or("").trim().to_string();
            if !note.is_empty() {
                if let Some(date) = w["date"].as_str() {
                    notes.entry(date.to_string()).or_insert(json!(note));
                }
            }
            if w["notes"].as_str().is_some_and(|s| !s.is_empty()) {
                w["notes"] = json!("");
            }
        }
        snap["day_notes"] = Value::Array(
            notes
                .into_iter()
                .map(|(date, text)| json!({"date":date,"text":text}))
                .collect(),
        );
    }
    if v < 6 {
        for w in rows(&mut snap, "workouts")? {
            w["notes"] = json!("");
        }
    }
    if v < 7 {
        for we in rows(&mut snap, "workout_exercises")? {
            default(we, "note", json!(""));
        }
    }
    snap["schema_version"] = json!(SCHEMA_VERSION);
    Ok((snap, v < SCHEMA_VERSION as u64))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_and_future_schema() {
        let input = json!({"schema_version":100});
        assert!(matches!(migrate(input), Err(CodecError::TooNew(100))));
        let snap = serde_json::to_value(lift_domain::model::Snapshot::empty(
            "test".into(),
            "now".into(),
        ))
        .unwrap();
        let bytes = encode(&snap, "later").unwrap();
        assert!(matches!(decode(&bytes, 4), Err(CodecError::TooLarge)));
        assert!(decode(b"bad gzip", 1024).is_err());
        let (decoded, migrated) = decode(&bytes, 1024 * 1024).unwrap();
        assert!(!migrated);
        assert_eq!(decoded["exported_at"], "later");
    }
}

pub mod export;
pub mod fitnotes;
pub mod names;
pub mod replay;
pub mod user_import;

/// Record ids for an import, continuing the store's allocator. Exercise ids
/// are kept above the built-in catalog, as createExercise does: an imported
/// exercise must never take a built-in's id.
pub(crate) struct Ids {
    next: u64,
}
impl Ids {
    pub(crate) fn new(snapshot: &Snapshot, ctx: &lift_domain::commands::Context) -> Self {
        Self {
            next: ctx
                .next_id
                .max(lift_domain::commands::next_available_id(snapshot)),
        }
    }
    pub(crate) fn next(&mut self) -> u64 {
        let n = self.next;
        self.next += 1;
        n
    }
    pub(crate) fn exercise(&mut self) -> u64 {
        self.next = self
            .next
            .max(lift_domain::commands::seed_catalog().len() as u64 + 1);
        self.next()
    }
    pub(crate) fn end(&self) -> u64 {
        self.next
    }
}
/// JavaScript `Number(v)` for the values a JSON file can hold.
pub(crate) fn js_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse().unwrap_or(f64::NAN)
            }
        }
        _ => f64::NAN,
    }
}
/// JavaScript truthiness.
pub(crate) fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
