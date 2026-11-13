use lift_domain::{commands::Context, model::Snapshot};
#[test]
fn json_import_matches_typescript_merge_and_repeat() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/engine-parity/json-import.json"
    ))
    .unwrap();
    for (i, case) in fixture["traces"].as_array().unwrap().iter().enumerate() {
        let mut snapshot: Snapshot = serde_json::from_value(case["initial"].clone()).unwrap();
        let mut ctx = Context {
            now: fixture["now"].as_str().unwrap().into(),
            today: fixture["today"].as_str().unwrap().into(),
            next_id: case["next_id"].as_u64().unwrap(),
        };
        let result = lift_codec::user_import::import(
            &mut snapshot,
            &case["data"].to_string(),
            case["replace"].as_bool().unwrap(),
            &mut ctx,
        )
        .unwrap();
        assert_eq!(result, case["result"], "result trace {i}");
        let expected: Snapshot = serde_json::from_value(case["expected"].clone()).unwrap();
        assert_eq!(snapshot, expected, "snapshot trace {i}");
    }
}
