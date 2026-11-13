//! Current, historical and position PR computation, matching
//! packages/core/src/store/prs.ts. Flags are derived from the rows on every
//! pass. Only rows whose flags change are written, so an unchanged history is
//! never copied.
use crate::{lookup::Lookup, model::Snapshot, queries::Indexes, units::weight_key};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

fn digits(b: &[u8]) -> Option<i64> {
    if b.is_empty() || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let mut n: i64 = 0;
    for d in b {
        n = n.checked_mul(10)?.checked_add(i64::from(d - b'0'))?;
    }
    Some(n)
}
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    // Day `d` of month `m` (1-based), letting the day overflow into later
    // months the way Date.parse does for "2024-02-30".
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468 + (d - 1)
}
/// Milliseconds since the epoch for the date-time forms `Date.parse`
/// accepts in practice: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, optionally followed
/// by `T` or a space, `HH:mm`, `:ss`, a fraction and `Z` or `±HH:mm`/`±HHmm`.
/// JavaScript reads a date-time without an offset as local time; this reads
/// it as UTC, because the portable engine has no time zone. Date-only forms
/// are UTC in both.
pub fn timestamp_checked(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() < 4 {
        return None;
    }
    let year = digits(&b[..4])?;
    let mut i = 4;
    let mut month = 1;
    let mut day = 1;
    if b.get(i) == Some(&b'-') {
        month = digits(b.get(i + 1..i + 3)?)?;
        i += 3;
        if b.get(i) == Some(&b'-') {
            day = digits(b.get(i + 1..i + 3)?)?;
            i += 3;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut ms = days_from_civil(year, month, day) * 86_400_000;
    if i == b.len() {
        return Some(ms);
    }
    if !matches!(b[i], b'T' | b't' | b' ') {
        return None;
    }
    i += 1;
    let hour = digits(b.get(i..i + 2)?)?;
    if b.get(i + 2) != Some(&b':') {
        return None;
    }
    let minute = digits(b.get(i + 3..i + 5)?)?;
    i += 5;
    let mut second = 0;
    let mut millis = 0;
    if b.get(i) == Some(&b':') {
        second = digits(b.get(i + 1..i + 3)?)?;
        i += 3;
        if b.get(i) == Some(&b'.') {
            let start = i + 1;
            let mut end = start;
            while b.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
            if end == start {
                return None;
            }
            let frac = &b[start..end.min(start + 3)];
            millis = digits(frac)? * 10_i64.pow(3 - frac.len() as u32);
            i = end;
        }
    }
    if hour > 24 || minute > 59 || second > 59 || (hour == 24 && (minute | second | millis) != 0) {
        return None;
    }
    ms += ((hour * 60 + minute) * 60 + second) * 1000 + millis;
    match b.get(i) {
        None => Some(ms),
        Some(b'Z' | b'z') if i + 1 == b.len() => Some(ms),
        Some(sign @ (b'+' | b'-')) => {
            let rest = &b[i + 1..];
            let (h, m) = match rest.len() {
                5 if rest[2] == b':' => (digits(&rest[..2])?, digits(&rest[3..])?),
                4 => (digits(&rest[..2])?, digits(&rest[2..])?),
                _ => return None,
            };
            if h > 23 || m > 59 {
                return None;
            }
            let offset = (h * 60 + m) * 60_000;
            Some(if *sign == b'+' {
                ms - offset
            } else {
                ms + offset
            })
        }
        _ => None,
    }
}
pub fn timestamp(iso: &str) -> i64 {
    timestamp_checked(iso).unwrap_or(0)
}
/// `new Date(ms).toISOString()`.
pub fn iso_from_ms(ms: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}
/// `Date.UTC(y, m - 1, d)` for the parts of a `YYYY-MM-DD` workout date, as
/// the FitNotes export computes midnight: out-of-range months and days roll
/// over, years 0 to 99 mean 1900 to 1999, and unreadable parts give None.
pub fn utc_midnight_ms(date: &str) -> Option<i64> {
    fn number(s: &str) -> Option<f64> {
        let t = s.trim();
        if t.is_empty() {
            return Some(0.0);
        }
        t.parse::<f64>().ok().filter(|v| v.is_finite())
    }
    let mut parts = date.split('-');
    let y = number(parts.next()?)?.trunc() as i64;
    let m = parts.next().map(number).unwrap_or(Some(1.0))?.trunc() as i64;
    let d = parts.next().map(number).unwrap_or(Some(1.0))?.trunc() as i64;
    let y = if (0..=99).contains(&y) { 1900 + y } else { y };
    let months = y.checked_mul(12)?.checked_add(m - 1)?;
    let (yy, mm) = (months.div_euclid(12), months.rem_euclid(12) + 1);
    days_from_civil(yy, mm, 1)
        .checked_add(d - 1)?
        .checked_mul(86_400_000)
}

struct Candidate<'a> {
    pos: usize,
    id: u64,
    we: u64,
    order: i64,
    weight: f64,
    reps: f64,
    date: &'a str,
    we_order: i64,
    time: i64,
}
impl Candidate<'_> {
    fn chronology(&self, other: &Self) -> Ordering {
        (self.date, self.we_order, self.order, self.time, self.id).cmp(&(
            other.date,
            other.we_order,
            other.order,
            other.time,
            other.id,
        ))
    }
}
fn compute(pool: &[&Candidate], current: &mut HashSet<usize>, historical: &mut HashSet<usize>) {
    let mut sorted = pool.to_vec();
    sorted.sort_by(|a, b| {
        b.weight
            .total_cmp(&a.weight)
            .then_with(|| b.reps.total_cmp(&a.reps))
            .then_with(|| a.chronology(b))
    });
    let mut max_reps = f64::NEG_INFINITY;
    for s in &sorted {
        if s.reps > max_reps {
            current.insert(s.pos);
        }
        max_reps = max_reps.max(s.reps);
    }
    sorted.sort_by(|a, b| a.chronology(b));
    let mut frontier: Vec<(f64, f64)> = vec![];
    for s in sorted {
        if frontier.iter().any(|(w, r)| *w >= s.weight && *r >= s.reps) {
            continue;
        }
        historical.insert(s.pos);
        frontier.retain(|(w, r)| !(s.weight >= *w && s.reps >= *r));
        frontier.push((s.weight, s.reps));
    }
}

type Flags = [bool; 4];
/// One exercise's sets: every position whose flags are derived, and the
/// candidates among them.
fn flags_for(
    snapshot: &Snapshot,
    affected: &[usize],
    candidates: &[Candidate],
    out: &mut Vec<(usize, Flags)>,
) {
    let refs: Vec<_> = candidates.iter().collect();
    let (mut cur, mut hist) = (HashSet::new(), HashSet::new());
    compute(&refs, &mut cur, &mut hist);
    let mut by_we: HashMap<u64, Vec<&Candidate>> = HashMap::new();
    for c in candidates {
        by_we.entry(c.we).or_default().push(c);
    }
    let mut positions: HashMap<usize, Vec<&Candidate>> = HashMap::new();
    for sets in by_we.values_mut() {
        sets.sort_by_key(|c| (c.order, c.id));
        for (p, c) in sets.iter().enumerate() {
            positions.entry(p).or_default().push(c);
        }
    }
    let (mut pcur, mut phist) = (HashSet::new(), HashSet::new());
    for bucket in positions.values() {
        compute(bucket, &mut pcur, &mut phist);
    }
    for &pos in affected {
        let want = [
            cur.contains(&pos),
            hist.contains(&pos),
            pcur.contains(&pos),
            phist.contains(&pos),
        ];
        let s = &snapshot.sets[pos];
        if [s.is_pr, s.was_pr, s.is_position_pr, s.was_position_pr] != want {
            out.push((pos, want));
        }
    }
}
fn apply(snapshot: &mut Snapshot, changes: Vec<(usize, Flags)>) {
    for (pos, f) in changes {
        let s = &mut snapshot.sets[pos];
        s.is_pr = f[0];
        s.was_pr = f[1];
        s.is_position_pr = f[2];
        s.was_position_pr = f[3];
    }
}
fn candidate<'a>(
    snapshot: &'a Snapshot,
    pos: usize,
    we_order: i64,
    date: &'a str,
) -> Option<Candidate<'a>> {
    let s = &snapshot.sets[pos];
    if s.is_planned {
        return None;
    }
    let (Some(w), Some(r)) = (s.weight, s.reps) else {
        return None;
    };
    Some(Candidate {
        pos,
        id: s.id,
        we: s.workout_exercise_id,
        order: s.order,
        weight: weight_key(Some(w)),
        reps: r,
        date,
        we_order,
        time: timestamp(&s.created_at),
    })
}

/// Full pass over the snapshot, for imports, migrations and RecomputePrs.
pub fn recompute(snapshot: &mut Snapshot, exercises: Option<&HashSet<u64>>) {
    let changes = {
        let snap = &*snapshot;
        let workout_dates: HashMap<_, _> = snap
            .workouts
            .iter()
            .map(|w| (w.id, w.date.as_str()))
            .collect();
        let wes: HashMap<_, _> = snap.workout_exercises.iter().map(|w| (w.id, w)).collect();
        let skip: HashSet<_> = snap
            .exercises
            .iter()
            .filter(|e| e.kind != "weight_reps")
            .map(|e| e.id)
            .collect();
        let mut groups: HashMap<u64, (Vec<usize>, Vec<Candidate>)> = HashMap::new();
        for (index, s) in snap.sets.iter().enumerate() {
            let Some(we) = wes.get(&s.workout_exercise_id) else {
                continue;
            };
            if skip.contains(&we.exercise_id)
                || exercises.is_some_and(|ids| !ids.contains(&we.exercise_id))
            {
                continue;
            }
            let group = groups.entry(we.exercise_id).or_default();
            group.0.push(index);
            let date = workout_dates.get(&we.workout_id).copied().unwrap_or("");
            if let Some(c) = candidate(snap, index, we.order, date) {
                group.1.push(c);
            }
        }
        let mut changes = vec![];
        for (affected, candidates) in groups.values() {
            flags_for(snap, affected, candidates, &mut changes);
        }
        changes
    };
    apply(snapshot, changes);
}

/// The same pass for the given exercises, reaching their sets through the
/// indexes instead of scanning the whole history.
pub fn recompute_indexed(snapshot: &mut Snapshot, exercises: &HashSet<u64>, look: &Lookup) {
    if exercises.is_empty() {
        return;
    }
    if !look.current(snapshot) {
        // Rows were removed in this change, so the base positions moved.
        let fresh = Indexes::build(snapshot);
        let inner = Lookup::new(&fresh, snapshot);
        full_indexed(snapshot, exercises, &inner);
    } else {
        full_indexed(snapshot, exercises, look);
    }
    look.mark_verified(exercises.iter().copied());
}
/// Number of set saves the append path handled (a diagnostic for tests and
/// benchmarks).
pub static APPEND_FAST_PATH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The PR update for one set appended at `pos` to an exercise whose flags
/// are verified, when the set is chronologically last for the exercise and
/// last in its workout_exercise. Then, by the rules `compute` applies:
/// - the set is a current PR exactly when no other set is at least as heavy
///   (by weightKey) with at least as many reps (an earlier exact tie wins),
///   and, being latest, its historical flag equals its current one;
/// - an existing set can only lose its current PR, and loses it exactly when
///   the new set beats it strictly; historical flags of earlier sets depend
///   only on earlier sets and do not change;
/// - the same holds within its position bucket, which no other set changes.
///
/// Returns false, changing nothing, whenever any of that cannot be shown;
/// the caller then runs the full pass.
pub fn append_fast(snapshot: &mut Snapshot, exercise: u64, pos: usize, look: &Lookup) -> bool {
    if !look.current(snapshot) || !look.is_verified(exercise) || pos < look.base_sets_len() {
        return false;
    }
    let negative_zero = |v: f64| v == 0.0 && v.is_sign_negative();
    let changes = {
        let snap = &*snapshot;
        if look
            .exercise_pos(snap, exercise)
            .is_some_and(|i| snap.exercises[i].kind != "weight_reps")
        {
            // Not a PR exercise: the full pass would leave every flag alone.
            return true;
        }
        let new = &snap.sets[pos];
        if new.is_pr || new.was_pr || new.is_position_pr || new.was_position_pr {
            return false;
        }
        let (Some(nw), Some(nr), false) = (new.weight, new.reps, new.is_planned) else {
            // Not a candidate: nothing in the pool changes, and its own
            // flags are already clear.
            return true;
        };
        let nw = weight_key(Some(nw));
        if negative_zero(nw) || negative_zero(nr) {
            return false;
        }
        let Some(we_pos) = look.we_pos(snap, new.workout_exercise_id) else {
            return false;
        };
        let we = &snap.workout_exercises[we_pos];
        if we.exercise_id != exercise {
            return false;
        }
        let Some(date) = look
            .workout_pos(snap, we.workout_id)
            .map(|i| snap.workouts[i].date.as_str())
        else {
            return false;
        };
        let new_time = timestamp(&new.created_at);
        let new_key = (date, we.order, new.order);
        // Candidates of every workout_exercise, in (order, id) order.
        let mut beats_new = false;
        let mut lose_current = vec![];
        let mut bucket = None;
        let mut groups: Vec<Vec<(usize, f64, f64)>> = vec![];
        let mut new_group = None;
        for wp in look.wes_of_exercise(snap, exercise) {
            let w = &snap.workout_exercises[wp];
            let wdate = look
                .workout_pos(snap, w.workout_id)
                .map(|i| snap.workouts[i].date.as_str())
                .unwrap_or("");
            let mut group = vec![];
            for sp in look.sets_of_we(snap, w.id) {
                if sp == pos {
                    continue;
                }
                let t = &snap.sets[sp];
                if t.is_planned {
                    continue;
                }
                let (Some(tw), Some(tr)) = (t.weight, t.reps) else {
                    continue;
                };
                let tw = weight_key(Some(tw));
                if negative_zero(tw) || negative_zero(tr) {
                    return false;
                }
                // Strictly earlier in the exercise's chronology.
                let key = (wdate, w.order, t.order);
                let earlier = match key.cmp(&new_key) {
                    Ordering::Less => true,
                    Ordering::Greater => false,
                    Ordering::Equal => (timestamp(&t.created_at), t.id) < (new_time, new.id),
                };
                if !earlier {
                    return false;
                }
                if w.id == new.workout_exercise_id && (t.order, t.id) > (new.order, new.id) {
                    return false;
                }
                if tw >= nw && tr >= nr {
                    beats_new = true;
                }
                if t.is_pr && nw >= tw && nr >= tr && (nw, nr) != (tw, tr) {
                    lose_current.push(sp);
                }
                group.push((sp, tw, tr, t.order, t.id));
            }
            group.sort_by_key(|c| (c.3, c.4));
            if w.id == new.workout_exercise_id {
                new_group = Some(groups.len());
                bucket = Some(group.len());
            }
            groups.push(group.into_iter().map(|c| (c.0, c.1, c.2)).collect());
        }
        let (Some(_), Some(p)) = (new_group, bucket) else {
            return false;
        };
        let mut position_beats_new = false;
        let mut lose_position = vec![];
        for group in &groups {
            if let Some(&(sp, tw, tr)) = group.get(p) {
                if tw >= nw && tr >= nr {
                    position_beats_new = true;
                }
                if snap.sets[sp].is_position_pr && nw >= tw && nr >= tr && (nw, nr) != (tw, tr) {
                    lose_position.push(sp);
                }
            }
        }
        (!beats_new, !position_beats_new, lose_current, lose_position)
    };
    let (current, position, lose_current, lose_position) = changes;
    let s = &mut snapshot.sets[pos];
    s.is_pr = current;
    s.was_pr = current;
    s.is_position_pr = position;
    s.was_position_pr = position;
    for sp in lose_current {
        snapshot.sets[sp].is_pr = false;
    }
    for sp in lose_position {
        snapshot.sets[sp].is_position_pr = false;
    }
    APPEND_FAST_PATH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    true
}
fn full_indexed(snapshot: &mut Snapshot, exercises: &HashSet<u64>, look: &Lookup) {
    let changes = {
        let snap = &*snapshot;
        let mut changes = vec![];
        let mut ids: Vec<_> = exercises.iter().copied().collect();
        ids.sort_unstable();
        for ex in ids {
            if look
                .exercise_pos(snap, ex)
                .is_some_and(|i| snap.exercises[i].kind != "weight_reps")
            {
                continue;
            }
            let mut affected = vec![];
            let mut candidates = vec![];
            for wp in look.wes_of_exercise(snap, ex) {
                let we = &snap.workout_exercises[wp];
                let date = look
                    .workout_pos(snap, we.workout_id)
                    .map(|i| snap.workouts[i].date.as_str())
                    .unwrap_or("");
                for sp in look.sets_of_we(snap, we.id) {
                    affected.push(sp);
                    if let Some(c) = candidate(snap, sp, we.order, date) {
                        candidates.push(c);
                    }
                }
            }
            flags_for(snap, &affected, &candidates, &mut changes);
        }
        changes
    };
    apply(snapshot, changes);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lenient_timestamps_match_date_parse() {
        let z = |s| timestamp_checked(s);
        assert_eq!(z("2024-01-01T10:00:00.123456Z"), Some(1704103200123));
        assert_eq!(z("2024-01-01T10:00:00+0530"), Some(1704083400000));
        assert_eq!(z("2024-01-01T10:00:00+05:30"), Some(1704083400000));
        assert_eq!(z("2024-01-01T24:00:00Z"), Some(1704153600000));
        assert_eq!(z("2024-02-30"), Some(1709251200000));
        assert_eq!(z("2024"), Some(1704067200000));
        assert_eq!(z("2024-05"), Some(1714521600000));
        assert_eq!(z("2024-01-01T10:00:00z"), Some(1704103200000));
        // Offset-less date-times are read as UTC (JavaScript: local time).
        assert_eq!(z("2024-01-01 10:00:00"), Some(1704103200000));
        assert_eq!(z("2024-01-01T10:00"), Some(1704103200000));
        for bad in [
            "2024-13-01",
            "2024-01-01T10:00:60Z",
            "2024-01-01T10:60:00Z",
            "  2024-01-01T10:00:00Z",
            "2024-01-01T10:00:00.Z",
            "2024-01-01T1:00:00Z",
            "2024-01-01T10:00:00+05",
            "now",
            "",
        ] {
            assert_eq!(z(bad), None, "{bad}");
        }
    }
}
