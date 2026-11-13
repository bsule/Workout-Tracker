//! Initial binding proof only; this crate does not open or mutate user data.
uniffi::setup_scaffolding!();

#[derive(uniffi::Record)]
pub struct EngineInfo {
    pub protocol_version: u32,
    pub engine_version: String,
}

#[derive(uniffi::Record)]
pub struct WeightResult {
    pub kilograms: f64,
    pub pounds: f64,
    pub comparison_key: f64,
}

#[uniffi::export]
pub fn engine_info() -> EngineInfo {
    EngineInfo {
        protocol_version: 1,
        engine_version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[uniffi::export]
pub fn inspect_weight(kilograms: Option<f64>) -> WeightResult {
    use lift_domain::units::{from_kg, weight_key, WeightUnit};
    WeightResult {
        kilograms: from_kg(kilograms, WeightUnit::Kg),
        pounds: from_kg(kilograms, WeightUnit::Lb),
        comparison_key: weight_key(kilograms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bridge_contract() {
        assert_eq!(engine_info().protocol_version, 1);
        assert_eq!(inspect_weight(Some(56.699)).comparison_key, 5670.0);
        assert_eq!(inspect_weight(None).kilograms, 0.0);
    }
}
