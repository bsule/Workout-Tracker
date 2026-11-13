import ExpoModulesCore
import Foundation

public class LiftEngineModule: Module {
  private let engineQueue = DispatchQueue(label: "lift.engine", qos: .userInitiated)
  private var engine: NativeEngine?
  private var session: String?

  private func active(_ id: String) throws -> NativeEngine {
    guard session == id, let engine else {
      throw NSError(domain: "LiftEngine", code: 1, userInfo: [NSLocalizedDescriptionKey: "Stale engine session"])
    }
    return engine
  }

  public func definition() -> ModuleDefinition {
    Name("LiftEngine")
    AsyncFunction("info") { () -> [String: Any] in
      let info = engineInfo()
      return ["protocolVersion": info.protocolVersion, "engineVersion": info.engineVersion]
    }.runOnQueue(engineQueue)

    AsyncFunction("open") { (id: String, path: String, deviceId: String, now: String) throws -> String in
      guard self.engine == nil else {
        throw NSError(domain: "LiftEngine", code: 2, userInfo: [NSLocalizedDescriptionKey: "Close the active session first"])
      }
      let localPath = path.hasPrefix("file://") ? URL(string: path)?.path ?? path : path
      let engine = try NativeEngine.open(path: localPath, deviceId: deviceId, now: now)
      self.engine = engine
      self.session = id
      return try engine.query(queryJson: "{\"kind\":\"counts\"}")
    }.runOnQueue(engineQueue)

    AsyncFunction("execute") { (id: String, commandId: String, generation: Double, commandJson: String, now: String, today: String) throws -> String in
      guard generation.isFinite, generation >= 1, generation.rounded() == generation, generation <= 9007199254740991 else {
        throw NSError(domain: "LiftEngine", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid generation"])
      }
      return try self.active(id).execute(commandId: commandId, generation: UInt64(generation), commandJson: commandJson, now: now, today: today)
    }.runOnQueue(engineQueue)

    AsyncFunction("query") { (id: String, queryJson: String) throws -> String in
      return try self.active(id).query(queryJson: queryJson)
    }.runOnQueue(engineQueue)

    AsyncFunction("importFile") { (id: String, request: String) throws -> String in
      return try self.active(id).importFileJson(requestJson: request)
    }.runOnQueue(engineQueue)

    AsyncFunction("snapshotBytes") { (id: String, now: String) throws -> Data in
      return try self.active(id).snapshotBytes(now: now)
    }.runOnQueue(engineQueue)

    AsyncFunction("backupBytes") { (id: String, slot: String) throws -> Data? in
      return try self.active(id).backupBytes(slot: slot)
    }.runOnQueue(engineQueue)

    AsyncFunction("saveRestorePoint") { (id: String, now: String) throws in
      try self.active(id).saveRestorePoint(now: now)
    }.runOnQueue(engineQueue)

    AsyncFunction("restorePoints") { (id: String) throws -> String in
      return try self.active(id).restorePoints()
    }.runOnQueue(engineQueue)

    AsyncFunction("syncState") { (id: String) throws -> String in
      return try self.active(id).syncState()
    }.runOnQueue(engineQueue)

    AsyncFunction("close") { (id: String) throws in
      try self.active(id).shutdown()
      self.engine = nil
      self.session = nil
    }.runOnQueue(engineQueue)

    OnDestroy {
      self.engineQueue.async {
        try? self.engine?.shutdown()
        self.engine = nil
        self.session = nil
      }
    }
  }
}
