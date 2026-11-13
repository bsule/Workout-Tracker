import ExpoModulesCore
import Foundation

public class LiftEngineModule: Module {
  private let engineQueue = DispatchQueue(label: "lift.engine", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("LiftEngine")

    AsyncFunction("info") { () -> [String: Any] in
      let info = engineInfo()
      return ["protocolVersion": info.protocolVersion, "engineVersion": info.engineVersion]
    }.runOnQueue(engineQueue)

    AsyncFunction("inspectWeight") { (kilograms: Double?) -> [String: Double] in
      let result = inspectWeight(kilograms: kilograms)
      return ["kilograms": result.kilograms, "pounds": result.pounds,
              "comparisonKey": result.comparisonKey]
    }.runOnQueue(engineQueue)
  }
}
