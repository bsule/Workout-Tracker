//! Copy-on-write snapshot tables. Preparing an isolated transaction shares
//! untouched tables; the first mutation clones only the affected table.
//! This preserves snapshot wire compatibility and publish-after-commit safety.
use serde::{Deserialize, Serialize};
use std::{
    ops::{Deref, DerefMut},
    sync::Arc,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(transparent)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct Table<T>(#[cfg_attr(feature = "typescript", ts(as = "Vec<T>"))] Arc<Vec<T>>);
impl<T> Default for Table<T> {
    fn default() -> Self {
        Self(Arc::new(Vec::new()))
    }
}
impl<T> From<Vec<T>> for Table<T> {
    fn from(rows: Vec<T>) -> Self {
        Self(Arc::new(rows))
    }
}
impl<T> FromIterator<T> for Table<T> {
    fn from_iter<I: IntoIterator<Item = T>>(rows: I) -> Self {
        rows.into_iter().collect::<Vec<_>>().into()
    }
}
impl<T> Deref for Table<T> {
    type Target = Vec<T>;
    fn deref(&self) -> &Vec<T> {
        &self.0
    }
}
impl<T: Clone> DerefMut for Table<T> {
    fn deref_mut(&mut self) -> &mut Vec<T> {
        Arc::make_mut(&mut self.0)
    }
}
impl<'a, T> IntoIterator for &'a Table<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter()
    }
}
impl<'a, T: Clone> IntoIterator for &'a mut Table<T> {
    type Item = &'a mut T;
    type IntoIter = std::slice::IterMut<'a, T>;
    fn into_iter(self) -> Self::IntoIter {
        self.iter_mut()
    }
}
impl<T: Clone> IntoIterator for Table<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;
    fn into_iter(self) -> Self::IntoIter {
        Arc::unwrap_or_clone(self.0).into_iter()
    }
}
impl<T> Table<T> {
    pub fn shares_storage_with(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
