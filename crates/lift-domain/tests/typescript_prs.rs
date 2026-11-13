use lift_domain::{model::Snapshot, prs};
#[test]
fn matches_typescript_pr_trace() {
    let fixtures: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/prs.json")).unwrap();
    for (pass, case) in fixtures.as_array().unwrap().iter().enumerate() {
        let mut input: Snapshot = serde_json::from_value(case["input"].clone()).unwrap();
        let expected: Snapshot = serde_json::from_value(case["expected"].clone()).unwrap();
        prs::recompute(&mut input, None);
        assert_eq!(input, expected, "trace step {pass}");
    }
}
