use lift_domain::units::{from_kg, round_for_display, to_kg, weight_key, WeightUnit};

#[test]
fn matches_typescript_oracle() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/engine-parity/units.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let input = case["input"].as_f64();
        assert_eq!(weight_key(input), case["weightKey"].as_f64().unwrap());
        assert_eq!(
            round_for_display(input.unwrap_or(0.0)),
            case["rounded"].as_f64().unwrap()
        );
        for (label, unit) in [("kg", WeightUnit::Kg), ("lb", WeightUnit::Lb)] {
            assert_eq!(from_kg(input, unit), case[label]["from"].as_f64().unwrap());
            assert_eq!(
                to_kg(input.unwrap_or(0.0), unit),
                case[label]["to"].as_f64().unwrap()
            );
        }
    }
}
