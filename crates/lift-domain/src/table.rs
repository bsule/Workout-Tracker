//! Persistent, chunked snapshot tables.
//!
//! Cloning a table is O(1); cloning a snapshot to prepare an isolated change
//! shares every row. The first write to a row copies only the chunk that holds
//! it, so a set save copies a few hundred rows rather than the whole history.
//! Unchanged chunks stay pointer-equal, which lets a diff, validation and index
//! maintenance skip them.
//!
//! Every row carries a storage ordinal. Ordinals increase strictly along the
//! table: `push` gives the next one, removals keep the survivors' ordinals, and
//! there is no insertion in the middle. Durable storage writes a row with its
//! ordinal, so reopening in ordinal order rebuilds the same row order without
//! rewriting later rows after a delete.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

const CHUNK: usize = 512;

static LINEAGE: AtomicU64 = AtomicU64::new(1);
fn lineage() -> u64 {
    LINEAGE.fetch_add(1, Ordering::Relaxed)
}

#[derive(Clone, Debug)]
pub struct Chunk<T> {
    rows: Vec<T>,
    ords: Vec<i64>,
}

#[derive(Clone, Debug)]
struct Inner<T> {
    chunks: Vec<Arc<Chunk<T>>>,
    /// Position of each chunk's first row.
    starts: Vec<usize>,
    len: usize,
    next_ordinal: i64,
    /// Identity of a table and its descendants. Tables built from scratch get
    /// a new lineage, so a diff knows positions of unrelated tables do not
    /// line up.
    lineage: u64,
    /// Bumped by every operation that removes rows. While it is unchanged
    /// within one lineage, a row keeps its position.
    removals: u64,
}

#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Table<T>(#[cfg_attr(feature = "typescript", ts(as = "Vec<T>"))] Arc<Inner<T>>);

impl<T> Clone for Table<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<T> Default for Table<T> {
    fn default() -> Self {
        Self(Arc::new(Inner {
            chunks: Vec::new(),
            starts: Vec::new(),
            len: 0,
            next_ordinal: 0,
            lineage: lineage(),
            removals: 0,
        }))
    }
}
impl<T: std::fmt::Debug> std::fmt::Debug for Table<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}
impl<T: PartialEq> PartialEq for Table<T> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().eq(other.iter())
    }
}
impl<T> From<Vec<T>> for Table<T> {
    fn from(rows: Vec<T>) -> Self {
        let n = rows.len() as i64;
        Self::from_ordered(rows.into_iter().zip(0..n).map(|(r, o)| (o, r)))
    }
}
impl<T> FromIterator<T> for Table<T> {
    fn from_iter<I: IntoIterator<Item = T>>(rows: I) -> Self {
        rows.into_iter().collect::<Vec<_>>().into()
    }
}

pub type Iter<'a, T> = std::iter::FlatMap<
    std::slice::Iter<'a, Arc<Chunk<T>>>,
    std::slice::Iter<'a, T>,
    fn(&'a Arc<Chunk<T>>) -> std::slice::Iter<'a, T>,
>;
fn chunk_rows<T>(c: &Arc<Chunk<T>>) -> std::slice::Iter<'_, T> {
    c.rows.iter()
}

impl<T> Table<T> {
    /// Rows with their stored ordinals. Ordinals must increase strictly.
    pub fn from_ordered(rows: impl IntoIterator<Item = (i64, T)>) -> Self {
        let mut inner = Inner {
            chunks: Vec::new(),
            starts: Vec::new(),
            len: 0,
            next_ordinal: 0,
            lineage: lineage(),
            removals: 0,
        };
        let mut current = Chunk {
            rows: Vec::with_capacity(CHUNK),
            ords: Vec::with_capacity(CHUNK),
        };
        for (ordinal, row) in rows {
            if current.rows.len() == CHUNK {
                inner.starts.push(inner.len - CHUNK);
                inner.chunks.push(Arc::new(std::mem::replace(
                    &mut current,
                    Chunk {
                        rows: Vec::with_capacity(CHUNK),
                        ords: Vec::with_capacity(CHUNK),
                    },
                )));
            }
            current.rows.push(row);
            current.ords.push(ordinal);
            inner.len += 1;
            inner.next_ordinal = inner.next_ordinal.max(ordinal.saturating_add(1));
        }
        if !current.rows.is_empty() {
            inner.starts.push(inner.len - current.rows.len());
            inner.chunks.push(Arc::new(current));
        }
        Self(Arc::new(inner))
    }
    pub fn len(&self) -> usize {
        self.0.len
    }
    pub fn is_empty(&self) -> bool {
        self.0.len == 0
    }
    pub fn iter(&self) -> Iter<'_, T> {
        self.0
            .chunks
            .iter()
            .flat_map(chunk_rows as fn(&Arc<Chunk<T>>) -> std::slice::Iter<'_, T>)
    }
    fn locate(&self, i: usize) -> Option<(usize, usize)> {
        if i >= self.0.len {
            return None;
        }
        let c = self.0.starts.partition_point(|s| *s <= i) - 1;
        Some((c, i - self.0.starts[c]))
    }
    pub fn get(&self, i: usize) -> Option<&T> {
        self.locate(i).map(|(c, o)| &self.0.chunks[c].rows[o])
    }
    pub fn ordinal(&self, i: usize) -> Option<i64> {
        self.locate(i).map(|(c, o)| self.0.chunks[c].ords[o])
    }
    pub fn first(&self) -> Option<&T> {
        self.get(0)
    }
    pub fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
    pub fn lineage(&self) -> u64 {
        self.0.lineage
    }
    pub fn removals(&self) -> u64 {
        self.0.removals
    }
    pub fn chunk_count(&self) -> usize {
        self.0.chunks.len()
    }
    /// First position and rows of chunk `c`.
    pub fn chunk(&self, c: usize) -> (usize, &[T]) {
        (self.0.starts[c], &self.0.chunks[c].rows)
    }
    pub fn same_chunk(&self, c: usize, other: &Self, d: usize) -> bool {
        match (self.0.chunks.get(c), other.0.chunks.get(d)) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            _ => false,
        }
    }
    pub fn chunk_ptr(&self, c: usize) -> *const () {
        Arc::as_ptr(&self.0.chunks[c]) as *const ()
    }
    pub fn position(&self, mut pred: impl FnMut(&T) -> bool) -> Option<usize> {
        self.iter().position(&mut pred)
    }
}

impl<T: Clone> Table<T> {
    fn inner(&mut self) -> &mut Inner<T> {
        Arc::make_mut(&mut self.0)
    }
    pub fn get_mut(&mut self, i: usize) -> Option<&mut T> {
        let (c, o) = self.locate(i)?;
        Some(&mut Arc::make_mut(&mut self.inner().chunks[c]).rows[o])
    }
    pub fn push(&mut self, row: T) {
        let inner = self.inner();
        let ordinal = inner.next_ordinal;
        inner.next_ordinal += 1;
        let room = inner.chunks.last().is_some_and(|c| c.rows.len() < CHUNK);
        if room {
            let last = Arc::make_mut(inner.chunks.last_mut().expect("checked above"));
            last.rows.push(row);
            last.ords.push(ordinal);
        } else {
            inner.starts.push(inner.len);
            inner.chunks.push(Arc::new(Chunk {
                rows: vec![row],
                ords: vec![ordinal],
            }));
        }
        inner.len += 1;
    }
    pub fn extend(&mut self, rows: impl IntoIterator<Item = T>) {
        for row in rows {
            self.push(row);
        }
    }
    pub fn clear(&mut self) {
        if self.0.len == 0 {
            return;
        }
        let inner = self.inner();
        inner.chunks.clear();
        inner.starts.clear();
        inner.len = 0;
        inner.removals += 1;
    }
    /// Remove known positions without testing every row. Untouched chunks stay
    /// shared, ordinals never change, and later appends never reuse an ordinal.
    pub fn remove_positions(&mut self, positions: &[usize]) {
        let mut positions: Vec<_> = positions
            .iter()
            .copied()
            .filter(|p| *p < self.len())
            .collect();
        positions.sort_unstable();
        positions.dedup();
        if positions.is_empty() {
            return;
        }
        let mut by_chunk: Vec<(usize, Vec<usize>)> = vec![];
        for p in positions {
            let (chunk, offset) = self.locate(p).expect("checked position");
            if by_chunk.last().is_none_or(|(c, _)| *c != chunk) {
                by_chunk.push((chunk, vec![]));
            }
            by_chunk.last_mut().unwrap().1.push(offset);
        }
        let inner = self.inner();
        let old = std::mem::take(&mut inner.chunks);
        let mut removals = by_chunk.into_iter().peekable();
        let mut chunks = Vec::with_capacity(old.len());
        for (c, chunk) in old.into_iter().enumerate() {
            if removals.peek().is_some_and(|(index, _)| *index == c) {
                let (_, offsets) = removals.next().unwrap();
                let mut next = Chunk {
                    rows: Vec::with_capacity(chunk.rows.len() - offsets.len()),
                    ords: Vec::with_capacity(chunk.ords.len() - offsets.len()),
                };
                let mut offsets = offsets.into_iter().peekable();
                for (i, (row, ordinal)) in chunk.rows.iter().zip(&chunk.ords).enumerate() {
                    if offsets.peek() == Some(&i) {
                        offsets.next();
                    } else {
                        next.rows.push(row.clone());
                        next.ords.push(*ordinal);
                    }
                }
                if !next.rows.is_empty() {
                    chunks.push(Arc::new(next));
                }
            } else {
                chunks.push(chunk);
            }
        }
        inner.starts.clear();
        inner.len = 0;
        for chunk in &chunks {
            inner.starts.push(inner.len);
            inner.len += chunk.rows.len();
        }
        inner.chunks = chunks;
        inner.removals += 1;
    }
    /// Keeps the rows `keep` accepts. Chunks with nothing removed stay shared.
    pub fn retain(&mut self, mut keep: impl FnMut(&T) -> bool) {
        let mut plan = Vec::with_capacity(self.0.chunks.len());
        let mut removed = false;
        for chunk in &self.0.chunks {
            let flags: Vec<bool> = chunk.rows.iter().map(&mut keep).collect();
            if flags.iter().all(|k| *k) {
                plan.push(None);
            } else {
                removed = true;
                plan.push(Some(flags));
            }
        }
        if !removed {
            return;
        }
        let inner = self.inner();
        let old = std::mem::take(&mut inner.chunks);
        let mut chunks: Vec<Arc<Chunk<T>>> = Vec::with_capacity(old.len());
        // Rebuilt chunks are merged with a rebuilt neighbor so repeated deletes
        // do not leave a trail of tiny chunks. Shared chunks are kept as is.
        let mut open: Option<Chunk<T>> = None;
        for (chunk, flags) in old.into_iter().zip(plan) {
            match flags {
                None => {
                    if let Some(c) = open.take() {
                        chunks.push(Arc::new(c));
                    }
                    chunks.push(chunk);
                }
                Some(flags) => {
                    let target = open.get_or_insert_with(|| Chunk {
                        rows: Vec::new(),
                        ords: Vec::new(),
                    });
                    for ((row, ord), k) in chunk.rows.iter().zip(&chunk.ords).zip(flags) {
                        if k {
                            if target.rows.len() == CHUNK {
                                let full = std::mem::replace(
                                    target,
                                    Chunk {
                                        rows: Vec::new(),
                                        ords: Vec::new(),
                                    },
                                );
                                chunks.push(Arc::new(full));
                            }
                            target.rows.push(row.clone());
                            target.ords.push(*ord);
                        }
                    }
                }
            }
        }
        if let Some(c) = open.take() {
            chunks.push(Arc::new(c));
        }
        chunks.retain(|c| !c.rows.is_empty());
        let mut starts = Vec::with_capacity(chunks.len());
        let mut len = 0;
        for c in &chunks {
            starts.push(len);
            len += c.rows.len();
        }
        inner.chunks = chunks;
        inner.starts = starts;
        inner.len = len;
        inner.removals += 1;
    }
    /// Mutates every row `pred` accepts, copying only the chunks that hold one.
    pub fn update_where(&mut self, mut pred: impl FnMut(&T) -> bool, mut f: impl FnMut(&mut T)) {
        let hits: Vec<usize> = self
            .0
            .chunks
            .iter()
            .enumerate()
            .filter(|(_, c)| c.rows.iter().any(&mut pred))
            .map(|(i, _)| i)
            .collect();
        if hits.is_empty() {
            return;
        }
        let inner = self.inner();
        for c in hits {
            for row in &mut Arc::make_mut(&mut inner.chunks[c]).rows {
                if pred(row) {
                    f(row);
                }
            }
        }
    }
    /// Copies every chunk. Prefer `get_mut` or `update_where` on large tables.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = &mut T> {
        self.inner()
            .chunks
            .iter_mut()
            .flat_map(|c| Arc::make_mut(c).rows.iter_mut())
    }
}

impl<T> std::ops::Index<usize> for Table<T> {
    type Output = T;
    fn index(&self, i: usize) -> &T {
        self.get(i).expect("table index out of bounds")
    }
}
impl<T: Clone> std::ops::IndexMut<usize> for Table<T> {
    fn index_mut(&mut self, i: usize) -> &mut T {
        self.get_mut(i).expect("table index out of bounds")
    }
}
impl<'a, T> IntoIterator for &'a Table<T> {
    type Item = &'a T;
    type IntoIter = Iter<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
impl<T: Clone> IntoIterator for Table<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter().cloned().collect::<Vec<_>>().into_iter()
    }
}
impl<T: Serialize> Serialize for Table<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(self.iter())
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Table<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Vec::<T>::deserialize(d)?.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexed_removal_matches_retain_without_changing_surviving_ordinals() {
        for victims in [
            vec![1999],
            vec![0, 511, 512, 1023, 1500, 1999],
            (512..1024).collect(),
            (0..2000).collect(),
            vec![100, 100, 9999, 3],
        ] {
            let mut indexed: Table<u32> = (0..2000).collect();
            let original = indexed.clone();
            let mut expected = original.clone();
            expected.retain(|row| !victims.contains(&(*row as usize)));
            indexed.remove_positions(&victims);
            assert_eq!(indexed, expected);
            for p in 0..indexed.len() {
                assert_eq!(indexed.ordinal(p), expected.ordinal(p));
            }
            assert_eq!(original.len(), 2000);
            indexed.push(9999);
            assert_eq!(indexed.ordinal(indexed.len() - 1), Some(2000));
        }
    }

    #[test]
    fn removing_a_tail_row_keeps_all_earlier_chunks_shared() {
        let mut table: Table<u32> = (0..2000).collect();
        let original = table.clone();
        table.remove_positions(&[1999]);
        for c in 0..3 {
            assert!(table.same_chunk(c, &original, c));
        }
        assert_eq!(original[1999], 1999);
    }
    #[test]
    fn retain_keeps_ordinals_and_shares_untouched_chunks() {
        let mut t: Table<u32> = (0..2000).collect();
        let before = t.clone();
        t.retain(|v| *v != 1500);
        assert_eq!(t.len(), 1999);
        assert!(t.same_chunk(0, &before, 0));
        assert_eq!(t.get(1500), Some(&1501));
        assert_eq!(t.ordinal(1500), Some(1501));
        t.push(7);
        assert_eq!(t.ordinal(1999), Some(2000));
        let ords: Vec<_> = (0..t.len()).map(|i| t.ordinal(i).unwrap()).collect();
        assert!(ords.windows(2).all(|w| w[0] < w[1]));
        assert_eq!(before.len(), 2000);
    }
    #[test]
    fn get_mut_copies_only_one_chunk() {
        let mut t: Table<u32> = (0..2000).collect();
        let before = t.clone();
        *t.get_mut(10).unwrap() = 99;
        assert!(!t.same_chunk(0, &before, 0));
        assert!(t.same_chunk(1, &before, 1));
        assert_eq!(before[10], 10);
        assert_eq!(t[10], 99);
    }
}
