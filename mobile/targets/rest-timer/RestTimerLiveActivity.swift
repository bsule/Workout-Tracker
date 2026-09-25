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
            .font(.caption2.weight(.semibold))
            .foregroundStyle(muted)
          // Smaller than .headline, and shrinks a little more before it
          // truncates: at .headline beside the timer, most names showed
          // only a word and a half.
          Text(context.state.exerciseName)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(foreground)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        Spacer(minLength: 8)
        RestTime(state: context.state)
          .font(.system(size: 26, weight: .bold, design: .rounded))
          .foregroundStyle(foreground)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 92, alignment: .trailing)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 14)
      .opacity(context.isStale ? 0.5 : 1)
      .activityBackgroundTint(background)
      .activitySystemActionForegroundColor(foreground)
    } dynamicIsland: { context in
      DynamicIsland {
        // Priority: the name's side gets the spare width, not the timer's.
        DynamicIslandExpandedRegion(.leading, priority: 1) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Since last set")
              .font(.caption2.weight(.semibold))
              .foregroundStyle(muted)
            Text(context.state.exerciseName)
              .font(.subheadline.weight(.semibold))
              .foregroundStyle(foreground)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          }
          // Fill the row's height and sit on its centre line, so the text
          // and the timer line up across the two regions.
          .frame(maxHeight: .infinity, alignment: .leading)
          .opacity(context.isStale ? 0.5 : 1)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RestTime(state: context.state)
            .font(.system(size: 24, weight: .bold, design: .rounded))
            .foregroundStyle(foreground)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 90, maxHeight: .infinity, alignment: .trailing)
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
      // Even margins in the expanded island. By default iOS leaves room at
      // the bottom for a bottom region, which this layout does not use, so the
      // row sat high; the sides get the same inset as each other.
      .contentMargins(.vertical, 14, for: .expanded)
      .contentMargins(.horizontal, 20, for: .expanded)
      // A soft white keyline. iOS sets its width; it shows only over dark
      // app content.
      .keylineTint(.white.opacity(0.5))
    }
  }
}
