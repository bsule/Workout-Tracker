use lift_domain::{
    commands::{apply_command, Command, Context},
    model::Snapshot,
};
#[test]
fn matches_typescript_commands() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/commands.json")).unwrap();
    let mut snap: Snapshot = serde_json::from_value(fixture["initial"].clone()).unwrap();
    let mut ctx = Context {
        now: fixture["now"].as_str().unwrap().into(),
        today: fixture["today"].as_str().unwrap().into(),
        next_id: 1001,
    };
    for (i, step) in fixture["steps"].as_array().unwrap().iter().enumerate() {
        let cmd: Command = serde_json::from_value(step["command"].clone()).unwrap();
        apply_command(&mut snap, cmd, &mut ctx).unwrap();
        let expected: Snapshot = serde_json::from_value(step["expected"].clone()).unwrap();
        assert_eq!(snap, expected, "step {i}: {}", step["command"]);
        let ix = lift_domain::queries::Indexes::build(&snap);
        fn numeric(v: &mut serde_json::Value) {
            match v {
                serde_json::Value::Number(n) => {
                    if let Some(f) = n.as_f64() {
                        *v = serde_json::json!(f)
                    }
                }
                serde_json::Value::Array(a) => {
                    for x in a {
                        numeric(x)
                    }
                }
                serde_json::Value::Object(o) => {
                    for x in o.values_mut() {
                        numeric(x)
                    }
                }
                _ => {}
            }
        }
        for case in step["queries"].as_array().unwrap() {
            let query = serde_json::from_value(case["query"].clone()).unwrap();
            let mut actual = lift_domain::queries::query(&snap, &ix, query);
            let mut expected = case["expected"].clone();
            numeric(&mut actual);
            numeric(&mut expected);
            assert_eq!(actual, expected, "query {}", case["query"]);
        }
    }
}
