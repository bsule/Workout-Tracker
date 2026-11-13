import Foundation

let info = engineInfo()
precondition(info.protocolVersion == 1)
precondition(!info.engineVersion.isEmpty)
let weight = inspectWeight(kilograms: 56.699)
precondition(weight.comparisonKey == 5670)
precondition(inspectWeight(kilograms: nil).kilograms == 0)
precondition(inspectWeight(kilograms: -1.125).comparisonKey == -112)
print("Swift → UniFFI → Rust compatibility smoke passed")
