package com.lift.engine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.lift.engine.generated.NativeEngine
import com.lift.engine.generated.engineInfo
import com.lift.engine.generated.exportLegacyFitnotes
import com.lift.engine.generated.exportLegacyJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.net.URI

class LiftEngineModule : Module() {
  private val dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
  private val engineScope = CoroutineScope(SupervisorJob() + dispatcher)
  private var engine: NativeEngine? = null
  private var session: String? = null

  private fun active(id: String): NativeEngine {
    check(session == id && engine != null) { "Stale engine session" }
    return engine!!
  }

  private fun version(value: Double): ULong {
    require(value.isFinite() && value >= 0.0 && value % 1.0 == 0.0 && value <= 9007199254740991.0) { "Invalid engine version" }
    return value.toULong()
  }

  override fun definition() = ModuleDefinition {
    Name("LiftEngine")
    AsyncFunction("info") {
      val info = engineInfo()
      mapOf("protocolVersion" to info.protocolVersion.toDouble(), "engineVersion" to info.engineVersion)
    }.runOnQueue(engineScope)

    AsyncFunction("exportLegacyFitnotes") { snapshotJson: String, skeleton: ByteArray, now: String -> exportLegacyFitnotes(snapshotJson, skeleton, now) }.runOnQueue(engineScope)
    AsyncFunction("exportLegacyJson") { snapshotJson: String, username: String, now: String -> exportLegacyJson(snapshotJson, username, now) }.runOnQueue(engineScope)

    AsyncFunction("open") { id: String, path: String, deviceId: String, now: String ->
      check(engine == null) { "Close the active session first" }
      val localPath = if (path.startsWith("file://")) URI(path).path else path
      val opened = NativeEngine.open(localPath, deviceId, now)
      engine = opened
      session = id
      opened.query("""{"kind":"counts"}""")
    }.runOnQueue(engineScope)

    AsyncFunction("execute") { id: String, commandId: String, generation: Double, commandJson: String, now: String, today: String ->
      require(generation.isFinite() && generation >= 1.0 && generation % 1.0 == 0.0 && generation <= 9007199254740991.0) { "Invalid generation" }
      active(id).execute(commandId, generation.toULong(), commandJson, now, today)
    }.runOnQueue(engineScope)

    AsyncFunction("query") { id: String, queryJson: String -> active(id).query(queryJson) }.runOnQueue(engineScope)
    AsyncFunction("importFile") { id: String, request: String -> active(id).importFileJson(request) }.runOnQueue(engineScope)
    AsyncFunction("snapshotBytes") { id: String, now: String -> active(id).snapshotBytes(now) }.runOnQueue(engineScope)
    AsyncFunction("backupBytes") { id: String, slot: String -> active(id).backupBytes(slot) }.runOnQueue(engineScope)
    AsyncFunction("saveRestorePoint") { id: String, now: String -> active(id).saveRestorePoint(now) }.runOnQueue(engineScope)
    AsyncFunction("restorePoints") { id: String -> active(id).restorePoints() }.runOnQueue(engineScope)
    AsyncFunction("syncState") { id: String -> active(id).syncState() }.runOnQueue(engineScope)
    AsyncFunction("prepareUpload") { id: String, now: String ->
      val value = active(id).prepareUpload(now)
      mapOf("bytes" to value.bytes, "generation" to value.generation.toDouble(), "revision" to value.revision.toDouble(), "etag" to value.etag, "deviceId" to value.deviceId)
    }.runOnQueue(engineScope)
    AsyncFunction("replaceSnapshot") { id: String, bytes: ByteArray, generation: Double, revision: Double, etag: String?, now: String ->
      active(id).replaceSnapshot(bytes, version(generation), version(revision), etag, now)
    }.runOnQueue(engineScope)
    AsyncFunction("acknowledgePush") { id: String, generation: Double, revision: Double, expectedEtag: String?, etag: String, now: String ->
      active(id).acknowledgePush(version(generation), version(revision), expectedEtag, etag, now)
    }.runOnQueue(engineScope)
    AsyncFunction("exportFitnotes") { id: String, skeleton: ByteArray, now: String -> active(id).exportFitnotes(skeleton, now) }.runOnQueue(engineScope)
    AsyncFunction("parseAiPlan") { id: String, raw: String -> active(id).parseAiPlan(raw) }.runOnQueue(engineScope)
    AsyncFunction("exportJson") { id: String, username: String, now: String -> active(id).exportJson(username, now) }.runOnQueue(engineScope)
    AsyncFunction("close") { id: String ->
      val current = active(id)
      current.shutdown()
      current.destroy()
      engine = null
      session = null
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
