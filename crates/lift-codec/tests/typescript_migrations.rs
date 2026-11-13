#[test]
fn matches_typescript_legacy_migrations() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/migrations.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let (output, migrated) = lift_codec::migrate(case["input"].clone()).unwrap();
        assert_eq!(
            output, case["expected"],
            "schema {}",
            case["input"]["schema_version"]
        );
        assert_eq!(migrated, case["migrated"].as_bool().unwrap());
        let encoded = lift_codec::encode(&output, output["exported_at"].as_str().unwrap()).unwrap();
        assert_eq!(
            lift_codec::decode(&encoded, 16 * 1024 * 1024).unwrap().0,
            output
        );
    }
}

#[test]
fn user_export_matches_typescript() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/commands.json")).unwrap();
    for step in fixture["steps"].as_array().unwrap() {
        let snapshot = serde_json::from_value(step["expected"].clone()).unwrap();
        let actual =
            lift_codec::export::user_json(&snapshot, "fixture", fixture["now"].as_str().unwrap());
        fn normalize(v: &mut serde_json::Value) {
            match v {
                serde_json::Value::Number(n) => {
                    if let Some(value) = n.as_f64() {
                        *v = serde_json::json!(value);
                    }
                }
                serde_json::Value::Array(rows) => {
                    for row in rows {
                        normalize(row)
                    }
                }
                serde_json::Value::Object(obj) => {
                    for row in obj.values_mut() {
                        normalize(row)
                    }
                }
                _ => {}
            }
        }
        let mut actual = actual;
        let mut expected = step["exported"].clone();
        normalize(&mut actual);
        normalize(&mut expected);
        assert_eq!(actual, expected);
    }
}
