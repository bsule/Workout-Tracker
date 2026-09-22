/**
 * The widget extension that draws the rest timer Live Activity. Named
 * RestTimerWidget, not RestTimer: the native module's pod is already the Swift
 * module RestTimer, and a second module of that name breaks the app build.
 * @bacons/apple-targets turns this folder into an Xcode target on every
 * `expo prebuild`. The app (mobile/modules/rest-timer) starts and ends the
 * activity; this target only draws it, so it needs no App Group.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: "widget",
  name: "RestTimerWidget",
  displayName: "Rest timer",
  bundleIdentifier: ".resttimer",
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
})
