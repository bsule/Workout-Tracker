//! Native SQLite/ZIP FitNotes export. Core Data model blobs are retained from
//! the bundled skeleton. No sql.js, JavaScript ZIP, or base64 conversion.
use lift_domain::{commands::seeds, model::Snapshot, prs::timestamp_checked, units::weight_key};
use rusqlite::{params_from_iter, types::Value, Connection};
use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
};
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
const EPOCH: i64 = 978307200000;
fn apple(iso: &str) -> Option<f64> {
    timestamp_checked(iso).map(|t| (t - EPOCH) as f64 / 1000.0)
}
fn midnight(date: &str) -> Result<f64, String> {
    apple(&format!("{date}T00:00:00Z")).ok_or_else(|| "Invalid workout date".into())
}
fn int(n: i64) -> Value {
    Value::Integer(n)
}
fn float(n: f64) -> Value {
    Value::Real(n)
}
fn text(s: &str) -> Value {
    Value::Text(s.into())
}
fn optional(n: Option<f64>) -> Value {
    n.map(float).unwrap_or(Value::Null)
}
fn note(s: &str) -> Value {
    if s.is_empty() {
        Value::Null
    } else {
        text(s)
    }
}
fn uuid() -> (i64, i64) {
    let bytes = *uuid::Uuid::new_v4().as_bytes();
    (
        i64::from_be_bytes(bytes[..8].try_into().unwrap()),
        i64::from_be_bytes(bytes[8..].try_into().unwrap()),
    )
}
fn insert(db: &Connection, table: &str, columns: &str, values: Vec<Value>) -> Result<(), String> {
    let sql = format!(
        "INSERT INTO {table} ({columns}) VALUES ({})",
        vec!["?"; values.len()].join(",")
    );
    db.execute(&sql, params_from_iter(values)).map_err(err)?;
    Ok(())
}
fn lookup(db: &Connection, table: &str) -> Result<HashMap<String, i64>, String> {
    let mut stmt = db
        .prepare(&format!("SELECT Z_PK,ZNAME FROM {table}"))
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            ))
        })
        .map_err(err)?;
    let mut out = HashMap::new();
    for row in rows {
        let (id, name) = row.map_err(err)?;
        if !name.is_empty() {
            out.insert(name.to_lowercase(), id);
        }
    }
    Ok(out)
}
fn next(counters: &mut HashMap<String, i64>, name: &str) -> i64 {
    let v = counters.entry(name.into()).or_default();
    *v += 1;
    *v
}
pub fn build(snapshot: &Snapshot, skeleton: &[u8], now: &str) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(skeleton)).map_err(err)?;
    let mut entry = archive.by_name("database.fitnotesdb").map_err(err)?;
    if entry.size() > 128 * 1024 * 1024 {
        return Err("Skeleton exceeds expansion limit".into());
    }
    let mut bytes = vec![];
    entry
        .by_ref()
        .take(128 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("Skeleton exceeds expansion limit".into());
    }
    let file = tempfile::NamedTempFile::new().map_err(err)?;
    std::fs::write(file.path(), bytes).map_err(err)?;
    let mut db = Connection::open(file.path()).map_err(err)?;
    let tx = db.transaction().map_err(err)?;
    populate(&tx, snapshot, now)?;
    tx.commit().map_err(err)?;
    db.close().map_err(|(_, e)| err(e))?;
    let bytes = std::fs::read(file.path()).map_err(err)?;
    let mut zip = zip::ZipWriter::new(Cursor::new(vec![]));
    zip.start_file(
        "database.fitnotesdb",
        zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6)),
    )
    .map_err(err)?;
    zip.write_all(&bytes).map_err(err)?;
    Ok(zip.finish().map_err(err)?.into_inner())
}
fn populate(db: &Connection, s: &Snapshot, now: &str) -> Result<(), String> {
    let mut ex_lookup = lookup(db, "ZEXERCISE")?;
    let categories = lookup(db, "ZEXERCISECATEGORY")?;
    let mut counters = HashMap::new();
    {
        let mut stmt = db
            .prepare("SELECT Z_NAME,Z_MAX FROM Z_PRIMARYKEY")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        for row in rows {
            let (k, v) = row.map_err(err)?;
            counters.insert(k, v);
        }
    }
    let mut exercises: HashMap<_, _> = seeds().into_iter().map(|e| (e.id, e)).collect();
    for e in &s.exercises {
        exercises.insert(e.id, e.clone());
    }
    let mut by_workout: HashMap<_, Vec<_>> = HashMap::new();
    for we in &s.workout_exercises {
        by_workout.entry(we.workout_id).or_default().push(we);
    }
    let mut by_we: HashMap<_, Vec<_>> = HashMap::new();
    for set in &s.sets {
        if !set.is_planned {
            by_we.entry(set.workout_exercise_id).or_default().push(set);
        }
    }
    let mut workouts: Vec<_> = s.workouts.iter().collect();
    workouts.sort_by_key(|w| (&w.date, w.id));
    let mut we_index = -(1_i64 << 62);
    let step = 1_i64 << 30;
    let now = apple(now).ok_or("Invalid export time")?;
    for w in workouts {
        let mut wes = by_workout.get(&w.id).cloned().unwrap_or_default();
        wes.sort_by_key(|we| (we.order, we.id));
        if wes.is_empty() {
            continue;
        }
        let wo = next(&mut counters, "Workout");
        let (hi, lo) = uuid();
        let date = midnight(&w.date)?;
        let day = s
            .day_notes
            .iter()
            .find(|n| n.date == w.date)
            .map(|n| n.text.trim())
            .unwrap_or("");
        let session = w.notes.trim();
        let combined = if !day.is_empty() && !session.is_empty() && day != session {
            format!("{day}\n{session}")
        } else if !day.is_empty() {
            day.into()
        } else {
            session.into()
        };
        insert(db,"ZWORKOUT","Z_PK,Z_ENT,Z_OPT,ZHKUPDATECOUNTER,ZHKWORKOUTACTIVITYTYPERAW,ZUUID1,ZUUID2,ZIMPORTEDDATE,ZDATE,ZSTARTTIME,ZSTARTEDWATCHWORKOUTATTIMESTAMP,ZSTOPTIME,ZNOTES,ZHKUUID",vec![int(wo),int(23),int(1),int(0),int(-1),int(hi),int(lo),Value::Null,float(date),optional(w.started_at.as_deref().and_then(apple)),Value::Null,optional(w.finished_at.as_deref().and_then(apple)),note(&combined),Value::Null])?;
        for we in wes {
            let Some(ex) = exercises.get(&we.exercise_id) else {
                continue;
            };
            let key = ex.name.to_lowercase();
            let ex_pk = if let Some(id) = ex_lookup.get(&key) {
                *id
            } else {
                let id = next(&mut counters, "Exercise");
                let (hi, lo) = uuid();
                let kind = match ex.kind.as_str() {
                    "bodyweight_reps" => 6,
                    "time_only" => 9,
                    "distance_time" => 12,
                    _ => 3,
                };
                insert(db,"ZEXERCISE","Z_PK,Z_ENT,Z_OPT,ZDEFAULTGRAPHQUERYRAW,ZDEFAULTGRAPHTIMEPERIODRAW,ZDOUBLEWEIGHTFORVOLUME,ZEXCLUDEFROMSTATS,ZFAVORITED,ZHKWORKOUTACTIVITYTYPERAW,ZINPUTTIMEFORMATRAW,ZKINDINT,ZRESTTIME,ZUNITINT,ZUSERHIDDEN,ZUUID1,ZUUID2,ZWEIGHTINCREMENTKG,ZWEIGHTINCREMENTLBS,ZWORKOUTCOUNT,ZCATEGORY,ZDEFAULTPLATEPROFILE,ZTRAININGMAXHEADENTRY,ZCREATEDAT,ZMOSTRECENTDATE,ZPERCENTSCALCROUNDINGKG,ZPERCENTSCALCROUNDINGLB,ZREPMAXCALCCACHE,ZREPMAXUSERDEFINED,ZNAME,ZNAMEKEYRAW,ZNOTES",vec![int(id),int(2),int(1),int(0),int(0),int(0),int(0),int(0),int(0),int(0),int(kind),int(-1),int(0),int(0),int(hi),int(lo),int(0),int(0),int(0),categories.get(&ex.category.to_lowercase()).map(|v|int(*v)).unwrap_or(Value::Null),Value::Null,Value::Null,float(now),Value::Null,float(0.0),float(0.0),float(0.0),float(0.0),text(&ex.name),Value::Null,Value::Null])?;
                ex_lookup.insert(key, id);
                id
            };
            let we_pk = next(&mut counters, "WorkoutExercise");
            let index = we_index;
            we_index = we_index.checked_add(step).ok_or("Export index overflow")?;
            let (hi, lo) = uuid();
            insert(db,"ZWORKOUTEXERCISE","Z_PK,Z_ENT,Z_OPT,ZINDEX,ZRESTTIME,ZUNITINT,ZUUID1,ZUUID2,ZWEIGHTINCREMENTKG,ZWEIGHTINCREMENTLBS,ZEXERCISE,ZSUPERSET,ZWORKOUT,ZDATE",vec![int(we_pk),int(24),int(1),int(index),int(-1),int(0),int(hi),int(lo),int(0),int(0),int(ex_pk),Value::Null,int(wo),float(date)])?;
            let mut sets = by_we.get(&we.id).cloned().unwrap_or_default();
            sets.sort_by_key(|s| (s.order, s.id));
            let mut set_index = index + 1;
            for set in sets {
                let pk = next(&mut counters, "WorkoutSet");
                let (hi, lo) = uuid();
                let (amount, unit) = if let Some(d) = set.distance_m.filter(|d| *d > 0.0) {
                    let (code, scale) = match set.distance_unit_display.to_lowercase().as_str() {
                        "mi" => (1, 1609.344),
                        "km" => (2, 1000.0),
                        "ft" => (4, 0.3048),
                        _ => (3, 1.0),
                    };
                    (weight_key(Some(d / scale)) as i64, code)
                } else {
                    (0, 0)
                };
                insert(db,"ZWORKOUTSET","Z_PK,Z_ENT,Z_OPT,ZDISTANCEAMOUNT,ZDISTANCEUNITINT,ZINDEX,ZISALLTIMERECORD,ZISCOMPLETED,ZISWORKSET,ZREPS,ZRESTTIME,ZTIME,ZUUID1,ZUUID2,ZWEIGHTKG,ZWEIGHTLBS,ZWORKOUTEXERCISEINDEX,ZEXERCISE,ZWORKOUT,ZWORKOUTEXERCISE,ZCOMPLETEDAT,ZDATE,ZRIR,ZRPE,ZNOTES",vec![int(pk),int(26),int(1),int(amount),int(unit),int(set_index),int(i64::from(set.is_pr)),int(1),int(1),float(set.reps.unwrap_or(0.0)),int(-1),float(set.time_seconds.unwrap_or(0.0)),int(hi),int(lo),int(weight_key(set.weight) as i64),int(weight_key(set.weight.map(|w|w*2.20462262)) as i64),int(index),int(ex_pk),int(wo),int(we_pk),float(apple(&set.created_at).unwrap_or(date)),float(date),float(-999999.0),float(-1.0),note(&set.note)])?;
                set_index = set_index
                    .checked_add(step)
                    .ok_or("Export set index overflow")?;
            }
        }
    }
    for (name, value) in counters {
        db.execute(
            "UPDATE Z_PRIMARYKEY SET Z_MAX=? WHERE Z_NAME=?",
            rusqlite::params![value, name],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn open_zip(bytes: &[u8]) -> (tempfile::NamedTempFile, Connection) {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut data = vec![];
        zip.by_name("database.fitnotesdb")
            .unwrap()
            .read_to_end(&mut data)
            .unwrap();
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), data).unwrap();
        let db = Connection::open(file.path()).unwrap();
        (file, db)
    }
    #[test]
    fn matches_existing_export_and_preserves_core_data_blobs() {
        let f: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/engine-parity/fitnotes-export.json"
        ))
        .unwrap();
        let snapshot: Snapshot = serde_json::from_value(f["snapshot"].clone()).unwrap();
        let skeleton = include_bytes!("../../../mobile/assets/fitnotes_skeleton.fitnotesdb");
        let bytes = build(&snapshot, skeleton, f["now"].as_str().unwrap()).unwrap();
        let (_file, db) = open_zip(&bytes);
        let (_sfile, source) = open_zip(skeleton);
        for sql in [
            "SELECT Z_PLIST FROM Z_METADATA",
            "SELECT Z_CONTENT FROM Z_MODELCACHE",
        ] {
            let a: Vec<u8> = db.query_row(sql, [], |r| r.get(0)).unwrap();
            let b: Vec<u8> = source.query_row(sql, [], |r| r.get(0)).unwrap();
            assert_eq!(a, b);
        }
        for query in f["queries"].as_array().unwrap() {
            let mut stmt = db.prepare(query["sql"].as_str().unwrap()).unwrap();
            let count = stmt.column_count();
            let values = stmt
                .query_map([], |row| {
                    let mut values = vec![];
                    for i in 0..count {
                        values.push(match row.get_ref(i)? {
                            rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                            rusqlite::types::ValueRef::Integer(n) => serde_json::json!(n as f64),
                            rusqlite::types::ValueRef::Real(n) => serde_json::json!(n),
                            rusqlite::types::ValueRef::Text(s) => {
                                serde_json::json!(std::str::from_utf8(s).unwrap())
                            }
                            rusqlite::types::ValueRef::Blob(_) => panic!("unexpected blob"),
                        });
                    }
                    Ok(serde_json::Value::Array(values))
                })
                .unwrap();
            let actual: Vec<_> = values.map(Result::unwrap).collect();
            let mut expected = query["rows"].clone();
            for row in expected.as_array_mut().unwrap() {
                for v in row.as_array_mut().unwrap() {
                    if let Some(n) = v.as_f64() {
                        *v = serde_json::json!(n);
                    }
                }
            }
            assert_eq!(
                serde_json::json!(actual),
                expected,
                "query {}",
                query["sql"]
            );
        }
    }
}
