use lift_domain::{commands::Command, model::Snapshot, queries::Query};
use lift_engine::Engine;
use serde_json::json;

#[test]
fn pages_match_full_history_and_reject_cursors_after_edits() {
    let mut engine = Engine::new(Snapshot::empty("test".into(), "now".into()), 0, 1, 1001).unwrap();
    for day in 1..=7 {
        let date = format!("2026-01-{day:02}");
        let pending = engine
            .prepare(
                format!("log-{day}"),
                Command::LogSet {
                    date: date.clone(),
                    exercise_id: 1,
                    input: json!({"weight":50,"reps":5}),
                },
                format!("{date}T12:00:00.000Z"),
                date,
            )
            .unwrap();
        engine.publish(pending).unwrap();
    }
    let expected = engine.query(Query::History {
        exercise_id: 1,
        offset: 0,
        limit: 100,
    });
    let mut cursor = None;
    let mut collected = vec![];
    let mut saved_cursor = None;
    loop {
        let reply = engine
            .try_query(Query::HistoryPage {
                exercise_id: 1,
                cursor,
                limit: 2,
            })
            .unwrap();
        assert_eq!(reply["data"]["total"], 7);
        assert!(reply["data"]["items"].as_array().unwrap().len() <= 2);
        collected.extend(reply["data"]["items"].as_array().unwrap().clone());
        cursor = reply["data"]["next_cursor"].as_str().map(String::from);
        if saved_cursor.is_none() {
            saved_cursor = cursor.clone();
        }
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(json!(collected), expected["data"]["items"]);
    assert!(engine
        .try_query(Query::HistoryPage {
            exercise_id: 2,
            cursor: saved_cursor.clone(),
            limit: 2
        })
        .is_err());
    let pending = engine
        .prepare(
            "edit".into(),
            Command::SetDayNote {
                date: "2026-01-01".into(),
                text: "change".into(),
            },
            "now".into(),
            "2026-01-01".into(),
        )
        .unwrap();
    engine.publish(pending).unwrap();
    let error = engine
        .try_query(Query::HistoryPage {
            exercise_id: 1,
            cursor: saved_cursor,
            limit: 2,
        })
        .unwrap_err();
    assert!(error.contains("restart pagination"));
    assert!(engine
        .try_query(Query::HistoryPage {
            exercise_id: 1,
            cursor: Some("garbage".into()),
            limit: 2
        })
        .is_err());
}

#[test]
fn isolated_preparations_share_untouched_tables_and_return_committed_prs() {
    let mut engine = Engine::new(Snapshot::empty("test".into(), "now".into()), 0, 1, 1001).unwrap();
    let pending = engine
        .prepare(
            "set".into(),
            Command::LogSet {
                date: "2026-01-01".into(),
                exercise_id: 1,
                input: json!({"weight":50,"reps":5}),
            },
            "2026-01-01T12:00:00.000Z".into(),
            "2026-01-01".into(),
        )
        .unwrap();
    assert_eq!(pending.receipt.result["set"]["is_pr"], true);
    engine.publish(pending).unwrap();
    let before = engine.snapshot().clone();
    let note = engine
        .prepare(
            "note".into(),
            Command::SetDayNote {
                date: "2026-01-01".into(),
                text: "hello".into(),
            },
            "now".into(),
            "2026-01-01".into(),
        )
        .unwrap();
    assert!(before.sets.shares_storage_with(&note.snapshot.sets));
    assert!(before.workouts.shares_storage_with(&note.snapshot.workouts));
    assert!(!before
        .day_notes
        .shares_storage_with(&note.snapshot.day_notes));
    let writes = lift_engine::write_set(&engine, &note).unwrap();
    assert_eq!(writes.rows.len(), 1);
    assert_eq!(writes.rows[0].table, "day_notes");
    engine.publish(note).unwrap();
    assert!(before.day_notes.is_empty());
    assert_eq!(
        engine.query(Query::DayNote {
            date: "2026-01-01".into()
        })["data"],
        "hello"
    );
    let set_id = engine.snapshot().sets[0].id;
    let updated = engine
        .prepare(
            "edit".into(),
            Command::UpdateSet {
                set_id,
                patch: json!({"weight":60}),
            },
            "now".into(),
            "2026-01-01".into(),
        )
        .unwrap();
    assert!(!before.sets.shares_storage_with(&updated.snapshot.sets));
    assert_eq!(before.sets[0].weight, Some(50.0));
    assert_eq!(updated.receipt.result["is_pr"], true);
}
