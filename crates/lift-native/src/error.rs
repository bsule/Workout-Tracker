//! Internal error kinds. The bridge turns each kind into one `EngineError`
//! variant, which Swift and Kotlin map to a stable JavaScript `error.code`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Data or a database from a newer build. Nothing was written.
    TooNew,
    /// No readable copy of the data.
    Corrupt,
    /// The request was based on an older generation or revision.
    Stale,
    Closed,
    Other,
}
#[derive(Debug, Clone)]
pub struct Fail {
    pub kind: Kind,
    pub message: String,
}
impl Fail {
    pub fn new(kind: Kind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
    pub fn too_new(m: impl Into<String>) -> Self {
        Self::new(Kind::TooNew, m)
    }
    pub fn corrupt(m: impl Into<String>) -> Self {
        Self::new(Kind::Corrupt, m)
    }
    pub fn stale(m: impl Into<String>) -> Self {
        Self::new(Kind::Stale, m)
    }
    pub fn closed(m: impl Into<String>) -> Self {
        Self::new(Kind::Closed, m)
    }
}
impl std::fmt::Display for Fail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl From<String> for Fail {
    fn from(message: String) -> Self {
        Self::new(Kind::Other, message)
    }
}
impl From<&str> for Fail {
    fn from(message: &str) -> Self {
        Self::new(Kind::Other, message)
    }
}
impl From<rusqlite::Error> for Fail {
    fn from(e: rusqlite::Error) -> Self {
        use rusqlite::ErrorCode::{DatabaseCorrupt, NotADatabase};
        let kind = match e.sqlite_error_code() {
            Some(DatabaseCorrupt | NotADatabase) => Kind::Corrupt,
            _ => Kind::Other,
        };
        Self::new(kind, e.to_string())
    }
}
impl From<lift_codec::CodecError> for Fail {
    fn from(e: lift_codec::CodecError) -> Self {
        match e {
            lift_codec::CodecError::TooNew(v) => {
                Self::too_new(format!("Snapshot schema {v} requires a newer app"))
            }
            other => Self::new(Kind::Other, other.to_string()),
        }
    }
}
pub type Result<T> = std::result::Result<T, Fail>;
