use lift_domain::{commands::Context, model::Snapshot};
#[test]
fn fitnotes_import_matches_typescript() {
    let f: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/fitnotes.json")).unwrap();
    let mut s: Snapshot = serde_json::from_value(f["initial"].clone()).unwrap();
    let mut ctx = Context {
        now: f["now"].as_str().unwrap().into(),
        today: f["today"].as_str().unwrap().into(),
        next_id: f["next_id"].as_u64().unwrap(),
    };
    let result =
        lift_codec::fitnotes::import(&mut s, f["csv"].as_str().unwrap(), true, &mut ctx).unwrap();
    assert_eq!(result, f["result"]);
    let expected: Snapshot = serde_json::from_value(f["expected"].clone()).unwrap();
    assert_eq!(s, expected);
}
