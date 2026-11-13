import ExpoModulesCore
import Foundation

/// Rejections carry a stable `code` JavaScript reads as `error.code`
/// (see `EngineErrorCode` in index.ts).
private func engineCode(_ error: Error) -> (String, String) {
  switch error {
  case EngineError.TooNew(let details): return ("ERR_ENGINE_TOO_NEW", details)
  case EngineError.Corrupt(let details): return ("ERR_ENGINE_CORRUPT", details)
  case EngineError.Stale(let details): return ("ERR_ENGINE_STALE", details)
  case EngineError.Closed(let details): return ("ERR_ENGINE_CLOSED", details)
  case EngineError.Failed(let details): return ("ERR_ENGINE", details)
  default: return ("ERR_ENGINE", String(describing: error))
  }
}

private func engineException(_ error: Error) -> Exception {
  if let exception = error as? Exception { return exception }
  let (code, message) = engineCode(error)
  return Exception(name: "EngineError", description: message, code: code)
}

/// Runs a bridge call, mapping every error to a coded exception.
private func coded<T>(_ body: () throws -> T) throws -> T {
  do { return try body() } catch { throw engineException(error) }
}

public class LiftEngineModule: Module {
  /// Commands, queries and session changes run in order here.
  private let engineQueue = DispatchQueue(label: "lift.engine", qos: .userInitiated)
  /// Whole-snapshot work (restore points, uploads, exports). The Rust engine
  /// copies the data under its lock and compresses outside it, so running these
  /// here keeps a set save from waiting behind a compression on `engineQueue`.
  private let captureQueue = DispatchQueue(label: "lift.engine.capture", qos: .utility)
  /// Guards `engine` and `session`, which both queues read.
  private let stateLock = NSLock()
  private var engine: NativeEngine?
  private var session: String?

  private func active(_ id: String) throws -> NativeEngine {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard session == id, let engine else {
      throw Exception(name: "EngineError", description: "Stale engine session", code: "ERR_ENGINE_CLOSED")
    }
    return engine
  }

  private func setActive(_ engine: NativeEngine?, _ session: String?) {
    stateLock.lock()
    self.engine = engine
    self.session = session
    stateLock.unlock()
  }

  private var hasEngine: Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return engine != nil
  }

  private func version(_ value: Double) throws -> UInt64 {
    guard value.isFinite, value >= 0, value.rounded() == value, value <= 9007199254740991 else {
      throw Exception(name: "EngineError", description: "Invalid engine version", code: "ERR_ENGINE")
    }
    return UInt64(value)
  }

  public func definition() -> ModuleDefinition {
    Name("LiftEngine")
    AsyncFunction("info") { () -> [String: Any] in
      let info = engineInfo()
      return ["protocolVersion": info.protocolVersion, "engineVersion": info.engineVersion]
    }.runOnQueue(engineQueue)

    AsyncFunction("exportLegacyFitnotes") { (snapshotJson: String, skeleton: Data, now: String) throws -> Data in
      return try coded { try exportLegacyFitnotes(snapshotJson: snapshotJson, skeleton: skeleton, now: now) }
    }.runOnQueue(captureQueue)

    AsyncFunction("exportLegacyJson") { (snapshotJson: String, username: String, now: String) throws -> String in
      return try coded { try exportLegacyJson(snapshotJson: snapshotJson, username: username, now: now) }
    }.runOnQueue(captureQueue)

    AsyncFunction("open") { (id: String, path: String, deviceId: String, now: String, legacyJson: String) throws -> String in
      guard !self.hasEngine else {
        throw Exception(name: "EngineError", description: "Close the active session first", code: "ERR_ENGINE")
      }
      let localPath = path.hasPrefix("file://") ? URL(string: path)?.path ?? path : path
      return try coded {
        let engine = try NativeEngine.open(path: localPath, deviceId: deviceId, now: now, legacyJson: legacyJson)
        self.setActive(engine, id)
        return try engine.query(queryJson: "{\"kind\":\"counts\"}")
      }
    }.runOnQueue(engineQueue)

    AsyncFunction("execute") { (id: String, commandId: String, generation: Double, commandJson: String, now: String, today: String) throws -> String in
      guard generation.isFinite, generation >= 1, generation.rounded() == generation, generation <= 9007199254740991 else {
        throw Exception(name: "EngineError", description: "Invalid generation", code: "ERR_ENGINE")
      }
      return try coded { try self.active(id).execute(commandId: commandId, generation: UInt64(generation), commandJson: commandJson, now: now, today: today) }
    }.runOnQueue(engineQueue)

    AsyncFunction("query") { (id: String, queryJson: String) throws -> String in
      return try coded { try self.active(id).query(queryJson: queryJson) }
    }.runOnQueue(engineQueue)

    AsyncFunction("importFile") { (id: String, request: String) throws -> String in
      return try coded { try self.active(id).importFileJson(requestJson: request) }
    }.runOnQueue(engineQueue)

    AsyncFunction("snapshotBytes") { (id: String, now: String) throws -> Data in
      return try coded { try self.active(id).snapshotBytes(now: now) }
    }.runOnQueue(captureQueue)

    AsyncFunction("backupBytes") { (id: String, slot: String) throws -> Data? in
      return try coded { try self.active(id).backupBytes(slot: slot) }
    }.runOnQueue(captureQueue)

    AsyncFunction("saveRestorePoint") { (id: String, now: String) throws in
      try coded { try self.active(id).saveRestorePoint(now: now) }
    }.runOnQueue(captureQueue)

    AsyncFunction("restorePoints") { (id: String) throws -> String in
      return try coded { try self.active(id).restorePoints() }
    }.runOnQueue(captureQueue)

    AsyncFunction("syncState") { (id: String) throws -> String in
      return try coded { try self.active(id).syncState() }
    }.runOnQueue(engineQueue)

    AsyncFunction("prepareUpload") { (id: String, now: String) throws -> [String: Any] in
      let value = try coded { try self.active(id).prepareUpload(now: now) }
      return ["bytes": value.bytes, "generation": value.generation, "revision": value.revision, "etag": value.etag as Any, "deviceId": value.deviceId]
    }.runOnQueue(captureQueue)

    AsyncFunction("replaceSnapshot") { (id: String, bytes: Data, generation: Double, revision: Double, etag: String?, now: String) throws -> String in
      return try coded { try self.active(id).replaceSnapshot(bytes: bytes, generation: self.version(generation), revision: self.version(revision), remoteEtag: etag, now: now) }
    }.runOnQueue(engineQueue)

    AsyncFunction("acknowledgePush") { (id: String, generation: Double, revision: Double, expectedEtag: String?, etag: String, now: String) throws in
      try coded { try self.active(id).acknowledgePush(generation: self.version(generation), revision: self.version(revision), expectedEtag: expectedEtag, etag: etag, now: now) }
    }.runOnQueue(engineQueue)

    AsyncFunction("exportFitnotes") { (id: String, skeleton: Data, now: String) throws -> Data in
      return try coded { try self.active(id).exportFitnotes(skeleton: skeleton, now: now) }
    }.runOnQueue(captureQueue)

    AsyncFunction("parseAiPlan") { (id: String, raw: String) throws -> String in
      return try coded { try self.active(id).parseAiPlan(raw: raw) }
    }.runOnQueue(engineQueue)

    AsyncFunction("exportJson") { (id: String, username: String, now: String) throws -> String in
      return try coded { try self.active(id).exportJson(username: username, now: now) }
    }.runOnQueue(captureQueue)

    AsyncFunction("close") { (id: String) throws in
      let engine = try self.active(id)
      // The session is cleared even if shutdown reports an error.
      defer { self.setActive(nil, nil) }
      try coded { try engine.shutdown() }
    }.runOnQueue(engineQueue)

    OnDestroy {
      self.engineQueue.async {
        self.stateLock.lock()
        let engine = self.engine
        self.stateLock.unlock()
        try? engine?.shutdown()
        self.setActive(nil, nil)
      }
    }
  }
}
