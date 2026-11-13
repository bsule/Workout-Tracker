import Foundation

let info = engineInfo()
precondition(info.protocolVersion == 1)
precondition(!info.engineVersion.isEmpty)
let weight = inspectWeight(kilograms: 56.699)
precondition(weight.comparisonKey == 5670)
precondition(inspectWeight(kilograms: nil).kilograms == 0)
precondition(inspectWeight(kilograms: -1.125).comparisonKey == -112)
print("Swift → UniFFI → Rust compatibility smoke passed")

// Real durable command/query round-trip through generated object bindings.
let database = FileManager.default.temporaryDirectory
  .appendingPathComponent("lift-smoke-\(UUID().uuidString).sqlite").path
do {
let engine = try NativeEngine.open(path: database, deviceId: "swift-smoke", now: "2026-01-01T12:00:00.000Z")
let command = "{\"op\":\"set_day_note\",\"date\":\"2026-01-01\",\"text\":\"from Swift\"}"
let receipt = try engine.execute(commandId: "swift-one", generation: 1, commandJson: command,
  now: "2026-01-01T12:00:00.000Z", today: "2026-01-01")
precondition(receipt.contains("swift-one"))
let result = try engine.query(queryJson: "{\"kind\":\"day_note\",\"date\":\"2026-01-01\"}")
precondition(result.contains("from Swift"))
let retried = try engine.execute(commandId: "swift-one", generation: 1, commandJson: command,
  now: "2026-01-01T12:00:00.000Z", today: "2026-01-01")
precondition(receipt == retried)
try engine.shutdown()
}
try FileManager.default.removeItem(atPath: database)
print("Swift → Rust → SQLite durable command/query smoke passed")
