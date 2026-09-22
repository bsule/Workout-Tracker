import ActivityKit
import SwiftUI
import WidgetKit

// Colors from mobile/src/theme/themeColors.ts (dark palette). The widget
// extension cannot read the JS theme.
private let background = Color(red: 0x0a / 255, green: 0x0a / 255, blue: 0x0a / 255)
private let foreground = Color(red: 0xf5 / 255, green: 0xf5 / 255, blue: 0xf5 / 255)
private let muted = Color(red: 0x9a / 255, green: 0x9a / 255, blue: 0x9a / 255)
private let accent = Color(red: 0x3e / 255, green: 0xe6 / 255, blue: 0xc0 / 255)

/// The LIFT mark: the tally strokes from mobile/assets/icon-source.svg,
/// without the tile. Drawn as a path so it is sharp at island size and
/// needs no image asset in the extension.
private struct LiftMark: Shape {
  func path(in rect: CGRect) -> Path {
    // The strokes' bounds in the SVG's 1024 space, round caps included
    // (the lines span 256...768 x 264...760; caps add half of the 80 width).
    let box = CGRect(x: 216, y: 224, width: 592, height: 576)
    let s = min(rect.width / box.width, rect.height / box.height)
    let ox = rect.midX - box.width * s / 2
    let oy = rect.midY - box.height * s / 2
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
      CGPoint(x: ox + (x - box.minX) * s, y: oy + (y - box.minY) * s)
    }
    var lines = Path()
    for x in [320, 448, 576, 704] as [CGFloat] {
      lines.move(to: p(x, 280))
      lines.addLine(to: p(x, 744))
    }
    lines.move(to: p(256, 760))
    lines.addLine(to: p(768, 264))
    return lines.strokedPath(StrokeStyle(lineWidth: 80 * s, lineCap: .round))
  }
}

/// The count-up time. iOS draws and ticks it by itself, so the app does not
/// need to run. The range ends at the cutoff, where the text stops.
private struct RestTime: View {
  let state: RestTimerAttributes.ContentState

  var body: some View {
    Text(
      timerInterval: state.startedAt...max(state.startedAt, state.endsAt),
      countsDown: false,
      showsHours: false
    )
    .monospacedDigit()
  }
}

struct RestTimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RestTimerAttributes.self) { context in
      // Lock Screen, Notification Center, StandBy. This is the only view on
      // iPhones without a Dynamic Island.
      HStack(alignment: .center, spacing: 12) {
        LiftMark()
          .fill(foreground)
          .frame(width: 24, height: 24)
        VStack(alignment: .leading, spacing: 2) {
          Text("Since last set")
            .font(.caption.weight(.semibold))
            .foregroundStyle(muted)
          Text(context.state.exerciseName)
            .font(.headline)
            .foregroundStyle(foreground)
            .lineLimit(1)
        }
        Spacer(minLength: 8)
        RestTime(state: context.state)
          .font(.system(size: 34, weight: .bold, design: .rounded))
          .foregroundStyle(foreground)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 120, alignment: .trailing)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
      .opacity(context.isStale ? 0.5 : 1)
      .activityBackgroundTint(background)
      .activitySystemActionForegroundColor(foreground)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Since last set")
              .font(.caption.weight(.semibold))
              .foregroundStyle(muted)
            Text(context.state.exerciseName)
              .font(.headline)
              .foregroundStyle(foreground)
              .lineLimit(1)
          }
          .padding(.leading, 4)
          .opacity(context.isStale ? 0.5 : 1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RestTime(state: context.state)
            .font(.system(size: 30, weight: .bold, design: .rounded))
            .foregroundStyle(foreground)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 110, alignment: .trailing)
            .padding(.trailing, 4)
            .opacity(context.isStale ? 0.5 : 1)
        }
      } compactLeading: {
        LiftMark()
          .fill(foreground)
          .frame(width: 18, height: 18)
          .padding(.leading, 2)
      } compactTrailing: {
        // Time only. Text(timerInterval:) asks for its widest possible size,
        // which pushes the island wide; the frame caps it.
        RestTime(state: context.state)
          .font(.system(.body, design: .rounded).weight(.semibold))
          .foregroundStyle(foreground)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 44, alignment: .trailing)
          .opacity(context.isStale ? 0.5 : 1)
      } minimal: {
        // Shown when another app's activity shares the island.
        RestTime(state: context.state)
          .font(.system(.caption, design: .rounded).weight(.semibold))
          .foregroundStyle(foreground)
          .multilineTextAlignment(.center)
          .frame(maxWidth: 36)
          .minimumScaleFactor(0.6)
      }
      .keylineTint(accent)
    }
  }
}
