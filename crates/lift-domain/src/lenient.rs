//! Field readers that accept what the TypeScript store tolerated, so a
//! snapshot the old app could load still loads here: missing or null strings
//! read as empty, null booleans as false, integral floats as integers.
use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::Deserialize;
use std::fmt;

struct StringV;
impl<'de> Visitor<'de> for StringV {
    type Value = String;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a string or null")
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<String, E> {
        Ok(v.to_owned())
    }
    fn visit_string<E: de::Error>(self, v: String) -> Result<String, E> {
        Ok(v)
    }
    fn visit_unit<E: de::Error>(self) -> Result<String, E> {
        Ok(String::new())
    }
    fn visit_none<E: de::Error>(self) -> Result<String, E> {
        Ok(String::new())
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<String, D::Error> {
        d.deserialize_any(StringV)
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<String, E> {
        Ok(v.to_string())
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<String, E> {
        Ok(v.to_string())
    }
}
pub fn string<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    d.deserialize_any(StringV)
}

struct BoolV;
impl<'de> Visitor<'de> for BoolV {
    type Value = bool;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a boolean or null")
    }
    fn visit_bool<E: de::Error>(self, v: bool) -> Result<bool, E> {
        Ok(v)
    }
    fn visit_unit<E: de::Error>(self) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_none<E: de::Error>(self) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<bool, D::Error> {
        d.deserialize_any(BoolV)
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<bool, E> {
        Ok(v != 0)
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<bool, E> {
        Ok(v != 0)
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<bool, E> {
        Ok(v != 0.0 && !v.is_nan())
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<bool, E> {
        Ok(!v.is_empty())
    }
}
/// JavaScript truthiness for the boolean columns.
pub fn boolean<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    d.deserialize_any(BoolV)
}

struct IntV;
impl<'de> Visitor<'de> for IntV {
    type Value = i64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a number or null")
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<i64, E> {
        Ok(v)
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<i64, E> {
        i64::try_from(v).map_err(|_| E::custom("integer out of range"))
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<i64, E> {
        if v.is_finite() {
            Ok(v.trunc() as i64)
        } else {
            Err(E::custom("non-finite integer"))
        }
    }
    fn visit_unit<E: de::Error>(self) -> Result<i64, E> {
        Ok(0)
    }
    fn visit_none<E: de::Error>(self) -> Result<i64, E> {
        Ok(0)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<i64, D::Error> {
        d.deserialize_any(IntV)
    }
}
pub fn integer<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    d.deserialize_any(IntV)
}

struct IdV;
impl Visitor<'_> for IdV {
    type Value = u64;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a non-negative integer id")
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<u64, E> {
        Ok(v)
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<u64, E> {
        u64::try_from(v).map_err(|_| E::custom("negative id"))
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<u64, E> {
        if v.is_finite() && v >= 0.0 && v.fract() == 0.0 && v <= 9_007_199_254_740_991.0 {
            Ok(v as u64)
        } else {
            Err(E::custom("invalid id"))
        }
    }
}
/// Integral floats such as `12.0` are accepted as ids.
pub fn id<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    d.deserialize_any(IdV)
}

struct SeqV<T>(std::marker::PhantomData<T>);
impl<'de, T: Deserialize<'de>> Visitor<'de> for SeqV<T> {
    type Value = Vec<T>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array or null")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
        let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(1 << 20));
        while let Some(v) = seq.next_element()? {
            out.push(v);
        }
        Ok(out)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Vec<T>, E> {
        Ok(Vec::new())
    }
    fn visit_none<E: de::Error>(self) -> Result<Vec<T>, E> {
        Ok(Vec::new())
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<Vec<T>, D::Error> {
        d.deserialize_any(self)
    }
}
/// A null table reads as empty (`snap.day_notes ?? []`). Only day notes are
/// optional; the TypeScript store could not load a snapshot without the
/// other tables.
pub fn table<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    d: D,
) -> Result<crate::table::Table<T>, D::Error> {
    Ok(d.deserialize_any(SeqV::<T>(std::marker::PhantomData))?
        .into())
}

pub fn settings<'de, D: Deserializer<'de>>(d: D) -> Result<serde_json::Value, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(match v {
        None | Some(serde_json::Value::Null) => serde_json::Value::Object(Default::default()),
        Some(v) => v,
    })
}

struct U32V;
impl<'de> Visitor<'de> for U32V {
    type Value = u32;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a schema version")
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<u32, E> {
        Ok(u32::try_from(v).unwrap_or(u32::MAX))
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<u32, E> {
        u32::try_from(v).map_err(|_| E::custom("invalid schema version"))
    }
    fn visit_unit<E: de::Error>(self) -> Result<u32, E> {
        Ok(0)
    }
    fn visit_none<E: de::Error>(self) -> Result<u32, E> {
        Ok(0)
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<u32, D::Error> {
        d.deserialize_any(U32V)
    }
}
pub fn version<'de, D: Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    d.deserialize_any(U32V)
}
