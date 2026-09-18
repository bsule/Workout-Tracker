/**
 * The app's dropdown menus, as real system menus.
 *
 * Wraps `@react-native-menu/menu`, which is a UIMenu on iOS and a PopupMenu on
 * Android. The menu attaches to whatever you pass as children, so the trigger
 * button is the anchor and the platform places the menu itself.
 *
 * This replaced four hand-rolled popups (an overflow menu, a date menu, and two
 * option pickers). Two things those had to do by hand are now free:
 *
 * - **No dismiss timing.** The custom menus faded out over a fixed duration and
 *   the callers deferred their action past it with `setTimeout`, so a sheet did
 *   not open while a menu was still on screen. The system menu is gone before
 *   `onPressAction` fires, so handlers run directly.
 * - **No anchor measuring.** The custom menus measured the trigger with
 *   `measureInWindow` and positioned a card against those coordinates.
 *
 * ## The fallback, and why it exists
 *
 * `MenuView` is a native view. A JS bundle can be reloaded in seconds, but a
 * native view only exists in a binary that was built with it. Between adding
 * this dependency and installing the next build, `MenuView` is simply not
 * registered, and React Native renders its "Unimplemented component" placeholder
 * in its place - which is what shipped to the Today screen's date label.
 *
 * So availability is checked at load, and when the view is missing every menu
 * falls back to `ActionSheetIOS`. That is core React Native, present in every
 * binary including Expo Go, and it is still a real system component rather than
 * a drawn lookalike. The fallback needs no code change to go away: once a build
 * contains `MenuView`, the check passes and the real menus take over.
 *
 * `image` names are SF Symbols on iOS and drawable resource names on Android.
 * The action sheet has no icons, so they are dropped there.
 */

import type { ReactNode } from "react"
import { MenuView, type MenuAction } from "@react-native-menu/menu"
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  UIManager,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import { currentMode } from "../theme/themeMode"

export type { MenuAction }

/**
 * Whether this binary actually contains the native menu view.
 *
 * Read once at module load: the answer cannot change while the app runs, since
 * it is a property of the binary. A missing view manager throws on some
 * versions and returns null on others, so both are treated as "absent".
 */
export const NATIVE_MENU_AVAILABLE = (() => {
  const um = UIManager as unknown as {
    getViewManagerConfig?: (name: string) => unknown
    hasViewManagerConfig?: (name: string) => boolean
  }
  // Two probes, because which one answers depends on the renderer. Either
  // saying yes is enough; both failing means the view is genuinely absent.
  try {
    if (um.getViewManagerConfig?.("MenuView")) return true
  } catch {
    // fall through to the second probe
  }
  try {
    return um.hasViewManagerConfig?.("MenuView") === true
  } catch {
    return false
  }
})()

/** Items the platform would not let the user pick anyway. */
function selectable(actions: MenuAction[]): MenuAction[] {
  return actions.filter(
    (a) => !a.attributes?.hidden && !a.attributes?.disabled
  )
}

function openFallback(
  actions: MenuAction[],
  title: string | undefined,
  onSelect: (id: string) => void
) {
  const items = selectable(actions)
  if (items.length === 0) return

  if (Platform.OS === "ios") {
    const destructiveIndex = items.findIndex(
      (a) => a.attributes?.destructive
    )
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        // The action sheet has no per-row subtitle, so a subtitle that carries
        // real information is folded into the label rather than dropped.
        options: [
          ...items.map((a) => (a.subtitle ? `${a.title} (${a.subtitle})` : a.title)),
          "Cancel",
        ],
        cancelButtonIndex: items.length,
        destructiveButtonIndex:
          destructiveIndex >= 0 ? destructiveIndex : undefined,
        userInterfaceStyle: currentMode(),
      },
      (index) => {
        const chosen = items[index]
        if (chosen?.id) onSelect(chosen.id)
      }
    )
    return
  }

  Alert.alert(title ?? "", undefined, [
    ...items.map((a) => ({
      text: a.title,
      style: a.attributes?.destructive
        ? ("destructive" as const)
        : ("default" as const),
      onPress: () => {
        if (a.id) onSelect(a.id)
      },
    })),
    { text: "Cancel", style: "cancel" as const },
  ])
}

export function NativeMenu({
  actions,
  onSelect,
  title,
  style,
  children,
}: {
  actions: MenuAction[]
  /** Receives the `id` of the chosen action. */
  onSelect: (id: string) => void
  /** Optional heading above the items. iOS renders it small and grey. */
  title?: string
  style?: StyleProp<ViewStyle>
  /** The trigger. The menu anchors to it. */
  children: ReactNode
}) {
  if (!NATIVE_MENU_AVAILABLE) {
    return (
      <Pressable
        onPress={() => openFallback(actions, title, onSelect)}
        unstable_pressDelay={0}
        style={style}
      >
        {children}
      </Pressable>
    )
  }

  return (
    <MenuView
      title={title}
      actions={actions}
      onPressAction={({ nativeEvent }) => onSelect(nativeEvent.event)}
      // The app picks its palette at boot and cannot follow the system
      // appearance at runtime (see themeMode.ts), so the menu is told which
      // variant to match rather than being left to guess from the OS.
      themeVariant={currentMode()}
      style={style}
    >
      {children}
    </MenuView>
  )
}
