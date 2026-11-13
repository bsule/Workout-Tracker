//! Compatibility with packages/core/src/units.ts. In particular, JavaScript
//! rounds negative half ties toward positive infinity, unlike f64::round().
pub const KG_PER_LB: f64 = 0.453_592_37;

#[derive(Clone, Copy, Debug)]
pub enum WeightUnit {
    Kg,
    Lb,
}

fn finite_or_zero(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn js_round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    let floor = value.floor();
    let rounded = if value - floor < 0.5 {
        floor
    } else {
        floor + 1.0
    };
    if rounded == 0.0 {
        0.0_f64.copysign(value)
    } else {
        rounded
    }
}

pub fn from_kg(value: Option<f64>, unit: WeightUnit) -> f64 {
    let value = finite_or_zero(value.unwrap_or(0.0));
    match unit {
        WeightUnit::Kg => value,
        WeightUnit::Lb => value * (1.0 / KG_PER_LB),
    }
}

pub fn to_kg(value: f64, unit: WeightUnit) -> f64 {
    let value = finite_or_zero(value);
    match unit {
        WeightUnit::Kg => value,
        WeightUnit::Lb => value * KG_PER_LB,
    }
}

pub fn round_for_display(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    js_round(value * 10.0) / 10.0
}

pub fn weight_key(value: Option<f64>) -> f64 {
    let value = finite_or_zero(value.unwrap_or(0.0));
    js_round(value * 100.0)
}

pub fn default_step(unit: WeightUnit) -> f64 {
    match unit {
        WeightUnit::Kg => 2.5,
        WeightUnit::Lb => 5.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn negative_ties_match_javascript() {
        assert_eq!(weight_key(Some(-1.125)), -112.0);
        assert!(weight_key(Some(-0.001)).is_sign_negative());
        assert_eq!(round_for_display(-1.25), -1.2);
    }
    #[test]
    fn invalid_weights_match_existing_zero_policy() {
        assert_eq!(weight_key(None), 0.0);
        assert_eq!(weight_key(Some(f64::NAN)), 0.0);
        assert_eq!(to_kg(f64::INFINITY, WeightUnit::Kg), 0.0);
        assert_eq!(from_kg(Some(f64::NEG_INFINITY), WeightUnit::Lb), 0.0);
    }
}
