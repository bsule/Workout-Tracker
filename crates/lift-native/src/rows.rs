//! Compact binary encoding of stored rows (database version 4).
//!
//! Every row starts with a format byte. Integers are LEB128 varints (signed
//! ones zigzagged), floats are their 8 IEEE-754 bytes so every value comes
//! back bit for bit, optional values carry a presence byte, and strings are a
//! length followed by UTF-8. Reading a row is a few slice copies instead of a
//! JSON parse, which is what dominated opening a large store.
use lift_domain::model::{DayNoteRow, ExerciseRow, GymRow, SetRow, WorkoutExerciseRow, WorkoutRow};

const FORMAT: u8 = 1;

#[derive(Debug)]
pub struct Malformed;
impl std::fmt::Display for Malformed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("malformed stored row")
    }
}

pub struct Writer(pub Vec<u8>);
impl Writer {
    fn u(&mut self, mut v: u64) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                self.0.push(byte);
                return;
            }
            self.0.push(byte | 0x80);
        }
    }
    fn i(&mut self, v: i64) {
        self.u(((v << 1) ^ (v >> 63)) as u64);
    }
    fn f(&mut self, v: f64) {
        self.0.extend_from_slice(&v.to_bits().to_le_bytes());
    }
    fn of(&mut self, v: Option<f64>) {
        match v {
            None => self.0.push(0),
            Some(v) => {
                self.0.push(1);
                self.f(v);
            }
        }
    }
    fn s(&mut self, v: &str) {
        self.u(v.len() as u64);
        self.0.extend_from_slice(v.as_bytes());
    }
    fn os(&mut self, v: &Option<String>) {
        match v {
            None => self.0.push(0),
            Some(v) => {
                self.0.push(1);
                self.s(v);
            }
        }
    }
}

pub struct Reader<'a>(&'a [u8]);
impl Reader<'_> {
    fn byte(&mut self) -> Result<u8, Malformed> {
        let (&b, rest) = self.0.split_first().ok_or(Malformed)?;
        self.0 = rest;
        Ok(b)
    }
    fn u(&mut self) -> Result<u64, Malformed> {
        let mut v: u64 = 0;
        for shift in (0..64).step_by(7) {
            let b = self.byte()?;
            v |= u64::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        Err(Malformed)
    }
    fn i(&mut self) -> Result<i64, Malformed> {
        let v = self.u()?;
        Ok(((v >> 1) as i64) ^ -((v & 1) as i64))
    }
    fn f(&mut self) -> Result<f64, Malformed> {
        if self.0.len() < 8 {
            return Err(Malformed);
        }
        let (bytes, rest) = self.0.split_at(8);
        self.0 = rest;
        Ok(f64::from_bits(u64::from_le_bytes(
            bytes.try_into().map_err(|_| Malformed)?,
        )))
    }
    fn of(&mut self) -> Result<Option<f64>, Malformed> {
        match self.byte()? {
            0 => Ok(None),
            1 => Ok(Some(self.f()?)),
            _ => Err(Malformed),
        }
    }
    fn s(&mut self) -> Result<String, Malformed> {
        let n = usize::try_from(self.u()?).map_err(|_| Malformed)?;
        if self.0.len() < n {
            return Err(Malformed);
        }
        let (bytes, rest) = self.0.split_at(n);
        self.0 = rest;
        String::from_utf8(bytes.to_vec()).map_err(|_| Malformed)
    }
    fn os(&mut self) -> Result<Option<String>, Malformed> {
        match self.byte()? {
            0 => Ok(None),
            1 => Ok(Some(self.s()?)),
            _ => Err(Malformed),
        }
    }
    fn bool(&mut self) -> Result<bool, Malformed> {
        match self.byte()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(Malformed),
        }
    }
    fn end(self) -> Result<(), Malformed> {
        if self.0.is_empty() {
            Ok(())
        } else {
            Err(Malformed)
        }
    }
}

pub trait Row: Sized {
    fn write(&self, w: &mut Writer);
    fn read(r: &mut Reader) -> Result<Self, Malformed>;
}
pub fn encode<T: Row>(row: &T) -> Vec<u8> {
    let mut w = Writer(Vec::with_capacity(64));
    w.0.push(FORMAT);
    row.write(&mut w);
    w.0
}
pub fn decode<T: Row>(bytes: &[u8]) -> Result<T, Malformed> {
    let mut r = Reader(bytes);
    if r.byte()? != FORMAT {
        return Err(Malformed);
    }
    let row = T::read(&mut r)?;
    r.end()?;
    Ok(row)
}

impl Row for ExerciseRow {
    fn write(&self, w: &mut Writer) {
        w.u(self.id);
        w.s(&self.name);
        w.s(&self.category);
        w.s(&self.kind);
        w.0.push(u8::from(self.is_custom));
        w.0.push(match self.is_deleted {
            None => 0,
            Some(false) => 1,
            Some(true) => 2,
        });
    }
    fn read(r: &mut Reader) -> Result<Self, Malformed> {
        Ok(Self {
            id: r.u()?,
            name: r.s()?,
            category: r.s()?,
            kind: r.s()?,
            is_custom: r.bool()?,
            is_deleted: match r.byte()? {
                0 => None,
                1 => Some(false),
                2 => Some(true),
                _ => return Err(Malformed),
            },
        })
    }
}
impl Row for WorkoutRow {
    fn write(&self, w: &mut Writer) {
        w.u(self.id);
        w.s(&self.date);
        w.s(&self.status);
        w.os(&self.started_at);
        w.os(&self.finished_at);
        w.s(&self.gym);
        w.s(&self.notes);
        w.s(&self.created_at);
    }
    fn read(r: &mut Reader) -> Result<Self, Malformed> {
        Ok(Self {
            id: r.u()?,
            date: r.s()?,
            status: r.s()?,
            started_at: r.os()?,
            finished_at: r.os()?,
            gym: r.s()?,
            notes: r.s()?,
            created_at: r.s()?,
        })
    }
}
impl Row for WorkoutExerciseRow {
    fn write(&self, w: &mut Writer) {
        w.u(self.id);
        w.u(self.workout_id);
        w.u(self.exercise_id);
        w.i(self.order);
        w.s(&self.note);
    }
    fn read(r: &mut Reader) -> Result<Self, Malformed> {
        Ok(Self {
            id: r.u()?,
            workout_id: r.u()?,
            exercise_id: r.u()?,
            order: r.i()?,
            note: r.s()?,
        })
    }
}
impl Row for SetRow {
    fn write(&self, w: &mut Writer) {
        w.u(self.id);
        w.u(self.workout_exercise_id);
        w.of(self.weight);
        w.of(self.reps);
        w.of(self.distance_m);
        w.s(&self.distance_unit_display);
        w.of(self.time_seconds);
        w.0.push(
            u8::from(self.is_planned)
                | (u8::from(self.is_pr) << 1)
                | (u8::from(self.was_pr) << 2)
                | (u8::from(self.is_position_pr) << 3)
                | (u8::from(self.was_position_pr) << 4),
        );
        w.s(&self.note);
        w.i(self.order);
        w.s(&self.created_at);
    }
    fn read(r: &mut Reader) -> Result<Self, Malformed> {
        let id = r.u()?;
        let workout_exercise_id = r.u()?;
        let weight = r.of()?;
        let reps = r.of()?;
        let distance_m = r.of()?;
        let distance_unit_display = r.s()?;
        let time_seconds = r.of()?;
        let flags = r.byte()?;
        if flags > 0x1f {
            return Err(Malformed);
        }
        Ok(Self {
            id,
            workout_exercise_id,
            weight,
            reps,
            distance_m,
            distance_unit_display,
            time_seconds,
            is_planned: flags & 1 != 0,
            is_pr: flags & 2 != 0,
            was_pr: flags & 4 != 0,
            is_position_pr: flags & 8 != 0,
            was_position_pr: flags & 16 != 0,
            note: r.s()?,
            order: r.i()?,
            created_at: r.s()?,
        })
    }
}
impl Row for GymRow {
    fn write(&self, w: &mut Writer) {
        w.u(self.id);
        w.s(&self.name);
    }
    fn read(r: &mut Reader) -> Result<Self, Malformed> {
        Ok(Self {
            id: r.u()?,
            name: r.s()?,
        })
    }
}
impl Row for DayNoteRow {
    fn write(&self, w: &mut Writer) {
        w.s(&self.date);
        w.s(&self.text);
    }
    fn read(r: &mut Reader) -> Result<Self, Malformed> {
        Ok(Self {
            date: r.s()?,
            text: r.s()?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rows_round_trip_bit_for_bit() {
        for weight in [
            Some(102.05812),
            Some(-0.0),
            Some(f64::MIN_POSITIVE),
            Some(1e300),
            None,
        ] {
            let row = SetRow {
                id: 9_007_199_254_740_991,
                workout_exercise_id: 3,
                weight,
                reps: Some(5.5),
                distance_m: None,
                distance_unit_display: "mi".into(),
                time_seconds: Some(0.1 + 0.2),
                is_planned: true,
                was_pr: true,
                was_position_pr: true,
                note: "ünïcode ✓".into(),
                order: -7,
                created_at: "2026-01-01T00:00:00.000Z".into(),
                ..Default::default()
            };
            let back: SetRow = decode(&encode(&row)).unwrap();
            assert_eq!(back.weight.map(f64::to_bits), row.weight.map(f64::to_bits));
            assert_eq!(
                back.time_seconds.map(f64::to_bits),
                row.time_seconds.map(f64::to_bits)
            );
            assert_eq!(back, row);
        }
        for is_deleted in [None, Some(false), Some(true)] {
            let e = ExerciseRow {
                id: 63,
                name: "x".into(),
                is_deleted,
                ..Default::default()
            };
            assert_eq!(decode::<ExerciseRow>(&encode(&e)).unwrap(), e);
        }
        let w = WorkoutRow {
            started_at: Some(String::new()),
            ..Default::default()
        };
        assert_eq!(decode::<WorkoutRow>(&encode(&w)).unwrap(), w);
        let bytes = encode(&w);
        assert!(decode::<WorkoutRow>(&bytes[..bytes.len() - 1]).is_err());
        assert!(decode::<GymRow>(&bytes).is_err());
        assert!(decode::<GymRow>(&[]).is_err());
    }
}
