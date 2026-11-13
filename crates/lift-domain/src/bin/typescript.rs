use ts_rs::TS;
fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("Output directory is required");
    lift_domain::model::Snapshot::export_all_to(&path).expect("snapshot types");
    lift_domain::commands::Command::export_all_to(&path).expect("command types");
    lift_domain::queries::Query::export_all_to(&path).expect("query types");
}
