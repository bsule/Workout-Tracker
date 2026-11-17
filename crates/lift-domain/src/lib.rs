//! Portable workout rules. No filesystem, platform, or UI dependencies.
pub mod units;

pub mod lenient;
pub mod model;
pub mod prs;

// TEMPORARY: see cardio_fix.rs.
pub mod cardio_fix;
pub mod commands;
pub mod diff;
pub mod gyms;
pub mod lookup;

pub mod queries;

pub mod stats;

pub mod ai;

pub mod table;
