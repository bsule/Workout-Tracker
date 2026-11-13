#[test]
fn replay_matches_live_trace_except_unrecoverable_legacy_copy() {
    let f: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/replay.json")).unwrap();
    let replayed = lift_codec::replay::replay(
        f["initial"].clone(),
        f["pending"].as_str().unwrap(),
        f["now"].as_str().unwrap(),
    )
    .unwrap();
    // copy_from cannot be recovered, but this trace subsequently deletes the
    // copied workout, leaving no surviving records from that operation.
    let actual: lift_domain::model::Snapshot = serde_json::from_value(replayed).unwrap();
    let expected: lift_domain::model::Snapshot =
        serde_json::from_value(f["expected"].clone()).unwrap();
    assert_eq!(actual, expected);
}
