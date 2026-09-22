// KEEP IN SYNC: mobile/targets/rest-timer/RestTimerAttributes.swift is a
// byte-for-byte copy of this file. The app starts the activity and the
// widget extension draws it; ActivityKit matches the two by the type name and
// the JSON shape of ContentState. Any drift means the extension cannot decode
// the state and the Live Activity shows nothing.

import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct RestTimerAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var exerciseName: String
    var startedAt: Date
    var endsAt: Date
  }
}
