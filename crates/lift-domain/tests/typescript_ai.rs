use lift_domain::{ai, commands::Context, model::Snapshot, units::WeightUnit};
#[test]
fn matches_ai_plan_parsing_and_application() {
    let f: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/ai.json")).unwrap();
    let plan = ai::parse(f["raw"].as_str().unwrap()).unwrap();
    fn normalize(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Number(n) => {
                if let Some(n) = n.as_f64() {
                    *v = serde_json::json!(n)
                }
            }
            serde_json::Value::Array(a) => {
                for v in a {
                    normalize(v)
                }
            }
            serde_json::Value::Object(o) => {
                for v in o.values_mut() {
                    normalize(v)
                }
            }
            _ => {}
        }
    }
    let mut actual = plan.clone();
    let mut expected = f["plan"].clone();
    normalize(&mut actual);
    normalize(&mut expected);
    assert_eq!(actual, expected);
    let mut snapshot: Snapshot = serde_json::from_value(f["initial"].clone()).unwrap();
    let mut ctx = Context {
        now: f["now"].as_str().unwrap().into(),
        today: f["today"].as_str().unwrap().into(),
        next_id: f["next_id"].as_u64().unwrap(),
    };
    let result = ai::apply(&mut snapshot, &plan, WeightUnit::Lb, &mut ctx).unwrap();
    assert_eq!(result, f["result"]);
    let expected: Snapshot = serde_json::from_value(f["expected"].clone()).unwrap();
    assert_eq!(snapshot, expected);
}
#[test]
fn invalid_ai_responses_are_rejected() {
    assert!(ai::parse("prose only").is_err());
    assert!(ai::parse("{}").is_err());
    assert!(ai::parse("null").is_err());
}
