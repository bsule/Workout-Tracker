//! Version-aware sync decisions. Hosts perform HTTP; these rules decide which
//! response may update adopted remote metadata.
use serde_json::{json, Value};
pub fn acknowledge_push(
    state: &Value,
    current: (u64, u64),
    uploaded: (u64, u64),
    expected_etag: Option<&str>,
    new_etag: &str,
    now: &str,
) -> Result<Value, String> {
    let (current_generation, current_revision) = current;
    let (source_generation, source_revision) = uploaded;
    if source_generation != current_generation {
        return Err("Upload belongs to a replaced dataset".into());
    }
    if source_revision > current_revision {
        return Err("Upload revision is ahead of local data".into());
    }
    if state["etag"].as_str() != expected_etag {
        return Err("Upload completed against an obsolete remote version".into());
    }
    if state["synced_revision"]
        .as_u64()
        .is_some_and(|r| r > source_revision)
    {
        return Err("Upload is older than a completed sync".into());
    }
    if new_etag.is_empty() {
        return Err("Missing upload ETag".into());
    }
    let mut next = state.clone();
    next["etag"] = json!(new_etag);
    next["synced_revision"] = json!(source_revision);
    next["last_synced_at"] = json!(now);
    next["dirty"] = json!(source_revision != current_revision);
    next["conflict_etag"] = Value::Null;
    Ok(next)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_upload_keeps_new_edits_dirty() {
        let state = json!({"etag":"before","dirty":true});
        let next =
            acknowledge_push(&state, (1, 8), (1, 7), Some("before"), "after", "now").unwrap();
        assert_eq!(next["dirty"], true);
        assert_eq!(next["synced_revision"], 7);
        assert!(acknowledge_push(&next, (1, 8), (1, 7), Some("before"), "other", "now").is_err());
        assert!(acknowledge_push(&next, (2, 8), (1, 8), Some("after"), "other", "now").is_err());
    }
}
