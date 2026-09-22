import ActivityKit
import ExpoModulesCore
import Foundation

struct RestTimerInput: Record {
  @Field var exerciseName: String = ""
  /// Epoch milliseconds.
  @Field var startedAt: Double = 0
  /// Epoch milliseconds.
  @Field var endsAt: Double = 0
}

/// The rest timer as an iOS Live Activity: Dynamic Island on iPhone 14 Pro
/// and later, Lock Screen and Notification Center on every iPhone.
///
/// One activity at a time. Below iOS 16.2 every function resolves with no
/// action. The SwiftUI views live in the widget extension
/// (mobile/targets/rest-timer); this module only starts, changes, and ends
/// the activity.
public class RestTimerModule: Module {
  /// Ends the activity at the cutoff while the process is alive. When iOS
  /// suspends the app first this never fires in time; the view then stops at
  /// the cutoff and dims (staleDate), and JS ends it on the next foreground.
  private var cutoffWork: DispatchWorkItem?

  public func definition() -> ModuleDefinition {
    Name("RestTimerModule")

    AsyncFunction("start") { (input: RestTimerInput) async throws in
      guard #available(iOS 16.2, *) else { return }
      try await RestTimerActivities.start(input)
      self.armCutoff(input.endsAt)
    }

    AsyncFunction("update") { (input: RestTimerInput) async throws in
      guard #available(iOS 16.2, *) else { return }
      // The user can swipe the activity away. Then there is nothing to
      // update, and the new set still deserves a timer.
      if !(await RestTimerActivities.update(input)) {
        try await RestTimerActivities.start(input)
      }
      self.armCutoff(input.endsAt)
    }

    AsyncFunction("end") { () async in
      self.cancelCutoff()
      guard #available(iOS 16.2, *) else { return }
      await RestTimerActivities.endAll()
    }

    AsyncFunction("current") { () -> [String: Any]? in
      guard #available(iOS 16.2, *) else { return nil }
      let current = RestTimerActivities.current()
      // A timer an earlier process started has no cutoff armed in this one.
      // Without it, a user who stays in the app past the cutoff and then
      // locks the phone leaves a frozen timer on the Lock Screen.
      if let endsAt = current?["endsAt"] as? Double {
        self.armCutoff(endsAt)
      }
      return current
    }
  }

  private func armCutoff(_ endsAtMs: Double) {
    DispatchQueue.main.async {
      self.cutoffWork?.cancel()
      let work = DispatchWorkItem {
        guard #available(iOS 16.2, *) else { return }
        // Cancelling the work item cannot stop a Task it already spawned. A
        // set saved at the cutoff can update the activity before this Task
        // runs, so end only an activity that still has this cutoff.
        Task { await RestTimerActivities.end(endingAt: endsAtMs) }
      }
      self.cutoffWork = work
      let delay = max(0, endsAtMs / 1000 - Date().timeIntervalSince1970)
      DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }
  }

  private func cancelCutoff() {
    DispatchQueue.main.async {
      self.cutoffWork?.cancel()
      self.cutoffWork = nil
    }
  }
}

@available(iOS 16.2, *)
private enum RestTimerActivities {
  static func state(_ input: RestTimerInput) -> RestTimerAttributes.ContentState {
    RestTimerAttributes.ContentState(
      exerciseName: input.exerciseName,
      startedAt: Date(timeIntervalSince1970: input.startedAt / 1000),
      endsAt: Date(timeIntervalSince1970: input.endsAt / 1000)
    )
  }

  static func content(_ input: RestTimerInput) -> ActivityContent<RestTimerAttributes.ContentState> {
    let s = state(input)
    // staleDate makes context.isStale true past the cutoff, so the extension
    // can dim a timer that the app could not end in time.
    return ActivityContent(state: s, staleDate: s.endsAt)
  }

  /// Activities still on screen, including ones an earlier process started.
  static var live: [Activity<RestTimerAttributes>] {
    Activity<RestTimerAttributes>.activities.filter {
      $0.activityState == .active || $0.activityState == .stale
    }
  }

  static func start(_ input: RestTimerInput) async throws {
    await endAll()
    // The user can turn Live Activities off for the app in iOS Settings.
    // That is a choice, not an error.
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    _ = try Activity.request(
      attributes: RestTimerAttributes(),
      content: content(input),
      pushType: nil
    )
  }

  /// Returns false when there was nothing to update.
  static func update(_ input: RestTimerInput) async -> Bool {
    let running = live
    guard let first = running.first else { return false }
    await first.update(content(input))
    // More than one can only come from a crash between request and end.
    for extra in running.dropFirst() {
      await extra.end(nil, dismissalPolicy: .immediate)
    }
    return true
  }

  /// Ends activities whose cutoff is `endsAtMs`, and leaves one a newer set
  /// has moved on. Half a second of slack covers the Double to Date round
  /// trip; a new set's cutoff is always a whole rest period later.
  static func end(endingAt endsAtMs: Double) async {
    for activity in live {
      let endsAt = activity.content.state.endsAt.timeIntervalSince1970 * 1000
      if abs(endsAt - endsAtMs) < 500 {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  static func endAll() async {
    for activity in Activity<RestTimerAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  static func current() -> [String: Any]? {
    guard let s = live.first?.content.state else { return nil }
    return [
      "exerciseName": s.exerciseName,
      "startedAt": s.startedAt.timeIntervalSince1970 * 1000,
      "endsAt": s.endsAt.timeIntervalSince1970 * 1000,
    ]
  }
}
