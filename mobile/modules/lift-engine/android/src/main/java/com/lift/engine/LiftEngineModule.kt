package com.lift.engine

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.lift.engine.generated.NativeEngine
import com.lift.engine.generated.engineInfo
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

  override fun definition() = ModuleDefinition {
    Name("LiftEngine")
    AsyncFunction("info") {
      val info = engineInfo()
      mapOf("protocolVersion" to info.protocolVersion.toDouble(), "engineVersion" to info.engineVersion)
    }.runOnQueue(engineScope)

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
