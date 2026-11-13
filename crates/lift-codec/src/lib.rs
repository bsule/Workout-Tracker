//! Legacy cloud snapshot compatibility. Local database versions are independent.
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use lift_domain::model::SCHEMA_VERSION;
use serde_json::{json, Value};
use std::io::{Read, Write};

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

pub fn decode(bytes: &[u8], max_expanded: usize) -> Result<(Value, bool), CodecError> {
    let mut raw = vec![];
    GzDecoder::new(bytes)
        .take((max_expanded as u64).saturating_add(1))
        .read_to_end(&mut raw)
        .map_err(invalid)?;
    if raw.len() > max_expanded {
        return Err(CodecError::TooLarge);
    }
    migrate(serde_json::from_slice(&raw).map_err(invalid)?)
}
pub fn encode(snapshot: &Value, now: &str) -> Result<Vec<u8>, CodecError> {
    let mut stamped = snapshot.clone();
    let obj = stamped
        .as_object_mut()
        .ok_or_else(|| invalid("Snapshot must be an object"))?;
    obj.insert("schema_version".into(), json!(SCHEMA_VERSION));
    obj.insert("exported_at".into(), json!(now));
    let mut gzip = GzEncoder::new(vec![], Compression::default());
    serde_json::to_writer(&mut gzip, &stamped).map_err(invalid)?;
    gzip.flush().map_err(invalid)?;
    gzip.finish().map_err(invalid)
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
        None => 0,
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
