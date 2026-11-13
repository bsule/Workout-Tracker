package com.lift.engine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.lift.engine.generated.EngineException
import com.lift.engine.generated.NativeEngine
import com.lift.engine.generated.engineInfo
import com.lift.engine.generated.exportLegacyFitnotes
import com.lift.engine.generated.exportLegacyJson
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.net.URI

/**
 * Rejections carry a stable `code` JavaScript reads as `error.code`
 * (see `EngineErrorCode` in index.ts).
 */
private fun engineException(error: Throwable): CodedException = when (error) {
  is CodedException -> error
  is EngineException.TooNew -> CodedException("ERR_ENGINE_TOO_NEW", error.details, error)
  is EngineException.Corrupt -> CodedException("ERR_ENGINE_CORRUPT", error.details, error)
  is EngineException.Stale -> CodedException("ERR_ENGINE_STALE", error.details, error)
  is EngineException.Closed -> CodedException("ERR_ENGINE_CLOSED", error.details, error)
  is EngineException.Failed -> CodedException("ERR_ENGINE", error.details, error)
  else -> CodedException("ERR_ENGINE", error.message ?: error.toString(), error)
}

/** Runs a bridge call, mapping every error to a coded exception. */
private inline fun <T> coded(body: () -> T): T =
  try { body() } catch (error: Throwable) { throw engineException(error) }

class LiftEngineModule : Module() {
  private val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
  private val engineScope = CoroutineScope(SupervisorJob() + dispatcher)
  private var engine: NativeEngine? = null
  private var session: String? = null

  private fun active(id: String): NativeEngine {
    val current = engine
    if (session != id || current == null) throw CodedException("ERR_ENGINE_CLOSED", "Stale engine session", null)
    return current
  }

  private fun version(value: Double): ULong {
    if (!(value.isFinite() && value >= 0.0 && value % 1.0 == 0.0 && value <= 9007199254740991.0)) {
      throw CodedException("ERR_ENGINE", "Invalid engine version", null)
    }
    return value.toULong()
  }

  override fun definition() = ModuleDefinition {
    Name("LiftEngine")
    AsyncFunction("info") {
      val info = engineInfo()
      mapOf("protocolVersion" to info.protocolVersion.toDouble(), "engineVersion" to info.engineVersion)
    }.runOnQueue(engineScope)

    AsyncFunction("exportLegacyFitnotes") { snapshotJson: String, skeleton: ByteArray, now: String -> coded { exportLegacyFitnotes(snapshotJson, skeleton, now) } }.runOnQueue(engineScope)
    AsyncFunction("exportLegacyJson") { snapshotJson: String, username: String, now: String -> coded { exportLegacyJson(snapshotJson, username, now) } }.runOnQueue(engineScope)

    AsyncFunction("open") { id: String, path: String, deviceId: String, now: String, legacyJson: String ->
      if (engine != null) throw CodedException("ERR_ENGINE", "Close the active session first", null)
      val localPath = if (path.startsWith("file://")) URI(path).path else path
      coded {
        val opened = NativeEngine.open(localPath, deviceId, now, legacyJson)
        engine = opened
        session = id
        opened.query("""{"kind":"counts"}""")
      }
    }.runOnQueue(engineScope)

    AsyncFunction("execute") { id: String, commandId: String, generation: Double, commandJson: String, now: String, today: String ->
      if (!(generation.isFinite() && generation >= 1.0 && generation % 1.0 == 0.0 && generation <= 9007199254740991.0)) {
        throw CodedException("ERR_ENGINE", "Invalid generation", null)
      }
      coded { active(id).execute(commandId, generation.toULong(), commandJson, now, today) }
    }.runOnQueue(engineScope)

    AsyncFunction("query") { id: String, queryJson: String -> coded { active(id).query(queryJson) } }.runOnQueue(engineScope)
    AsyncFunction("importFile") { id: String, request: String -> coded { active(id).importFileJson(request) } }.runOnQueue(engineScope)
    AsyncFunction("snapshotBytes") { id: String, now: String -> coded { active(id).snapshotBytes(now) } }.runOnQueue(engineScope)
    AsyncFunction("backupBytes") { id: String, slot: String -> coded { active(id).backupBytes(slot) } }.runOnQueue(engineScope)
    AsyncFunction("saveRestorePoint") { id: String, now: String -> coded { active(id).saveRestorePoint(now) } }.runOnQueue(engineScope)
    AsyncFunction("restorePoints") { id: String -> coded { active(id).restorePoints() } }.runOnQueue(engineScope)
    AsyncFunction("syncState") { id: String -> coded { active(id).syncState() } }.runOnQueue(engineScope)
    AsyncFunction("prepareUpload") { id: String, now: String ->
      val value = coded { active(id).prepareUpload(now) }
      mapOf("bytes" to value.bytes, "generation" to value.generation.toDouble(), "revision" to value.revision.toDouble(), "etag" to value.etag, "deviceId" to value.deviceId)
    }.runOnQueue(engineScope)
    AsyncFunction("replaceSnapshot") { id: String, bytes: ByteArray, generation: Double, revision: Double, etag: String?, now: String ->
      coded { active(id).replaceSnapshot(bytes, version(generation), version(revision), etag, now) }
    }.runOnQueue(engineScope)
    AsyncFunction("acknowledgePush") { id: String, generation: Double, revision: Double, expectedEtag: String?, etag: String, now: String ->
      coded { active(id).acknowledgePush(version(generation), version(revision), expectedEtag, etag, now) }
    }.runOnQueue(engineScope)
    AsyncFunction("exportFitnotes") { id: String, skeleton: ByteArray, now: String -> coded { active(id).exportFitnotes(skeleton, now) } }.runOnQueue(engineScope)
    AsyncFunction("parseAiPlan") { id: String, raw: String -> coded { active(id).parseAiPlan(raw) } }.runOnQueue(engineScope)
    AsyncFunction("exportJson") { id: String, username: String, now: String -> coded { active(id).exportJson(username, now) } }.runOnQueue(engineScope)
    AsyncFunction("close") { id: String ->
      val current = active(id)
      // The session is cleared even if shutdown reports an error.
      try {
        coded { current.shutdown() }
      } finally {
        engine = null
        session = null
        current.destroy()
      }
    }.runOnQueue(engineScope)

    OnDestroy {
      engineScope.launch {
        try { engine?.shutdown() } finally {
          engine?.destroy()
          engine = null
          session = null
          dispatcher.close()
        }
      }
    }
  }
}
