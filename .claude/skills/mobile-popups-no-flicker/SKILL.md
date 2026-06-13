---
name: mobile-popups-no-flicker
description: Use when building or fixing any popup, modal, overlay, dropdown, picker, action sheet, or confirm dialog in the React Native (Expo) mobile app (mobile/) — especially if it flickers, flashes, stutters, double-animates, blinks on open/close, or needs a double tap to dismiss.
---

# Mobile Popups Without Flicker

## Overview

In this app's `mobile/` (React Native + Expo) client, **do not use `react-native-modal` for popups.** Its backdrop transition flashes on dismiss and its keyboard handling makes the card stutter / "double-animate" on close. Every hand-built popup here uses the same proven pattern instead:

**A plain `Animated.View` overlay driven by one JS opacity value, a `mounted` state that unmounts only *after* the fade-out finishes, a sibling (not nested) `Pressable` backdrop, and store mutations deferred until after the fade.**

Reference implementations already in the repo: `GymPickerModal` (`src/screens/DayScreen.tsx`), `NoteEditorSheet` (`src/screens/SetLoggerScreen.tsx`), `SetPickerOverlay` (`src/screens/SetLoggerScreen.tsx`).

## The five rules

1. **No `react-native-modal`.** It is the flicker. (`PopupModal` wraps it — avoid it for new popups too.)
2. **One `Animated.Value` opacity**, `useNativeDriver: true`. You control the fade — nothing else animates it.
3. **`mounted` + delayed unmount.** Set `mounted=true` on open; on close, fade to 0 and set `mounted=false` only in the animation's `finished` callback. `if (!mounted) return null`.
4. **Sibling backdrop, never nested.** A full-screen `Pressable` (`StyleSheet.absoluteFill`, `onPress={onClose}`) and the card are *siblings* under the overlay. Nesting a Pressable card inside a Pressable backdrop causes the double-tap-to-dismiss bug. Absorb taps on empty card area with `onStartShouldSetResponder={() => true}` on the card View — never wrap option Pressables in another Pressable.
5. **Defer store mutations past the fade.** Call `onClose()` first, then run any `localApi` mutation in `setTimeout(fn, FADE_MS + 40)`. Mutating mid-fade re-renders the parent and visibly stutters the overlay. (Same root cause as the repo's "don't await between a localApi mutation and navigation" rule.)

## Canonical implementation

```tsx
const FADE_MS = 160

function MyPopup({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, {
        toValue: 1, duration: FADE_MS,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0, duration: FADE_MS,
      easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => { if (finished) setMounted(false) }) // delayed unmount
  }, [visible, opacity])

  // Defer mutations so they don't re-render the parent mid-fade.
  function pick(value: string) {
    onClose()
    setTimeout(() => api.someMutation(value), FADE_MS + 40)
  }

  if (!mounted) return null

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}     // stop capturing during fade-out
      style={[styles.overlay, { opacity }]}          // absoluteFillObject + dim bg + center
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />   {/* sibling backdrop */}
      <View style={styles.card} onStartShouldSetResponder={() => true}> {/* absorbs stray taps */}
        {/* option Pressables here — NOT wrapped in another Pressable */}
      </View>
    </Animated.View>
  )
}
```

```tsx
overlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0,0,0,0.55)",
  alignItems: "center", justifyContent: "center",
  zIndex: 50, elevation: 50,
},
```

**Render the popup at the screen root** (a sibling of the screen's `ScrollView`/content), like `NoteEditorSheet` and `GymPickerModal` do — `absoluteFillObject` covers the viewport only when it isn't nested inside scrolling content.

## Variant: popup defined inside a ScrollView

If the popup component must live *inside* a `ScrollView` (e.g. it's part of a panel like `RecordsPanel`), `absoluteFill` would fill the scroll content, not the screen. Host the same `Animated.View` overlay in React Native's **core** `Modal` (NOT react-native-modal) with `animationType="none"` so it portals to the screen and centers, while your JS opacity still drives the fade:

```tsx
<Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
  <Animated.View style={[styles.overlay, { opacity }]}>
    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
    <View style={styles.card} onStartShouldSetResponder={() => true}>{/* ... */}</View>
  </Animated.View>
</Modal>
```

`animationType="none"` is essential — core `Modal`'s own `"fade"` animation reintroduces the flicker and a tap-swallow on dismiss. See `SetPickerOverlay`.

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Backdrop flashes/blinks on close | `react-native-modal` backdrop transition | Use the `Animated.View` overlay pattern |
| Card "double-animates" / stutters on close | Store mutation fired during the fade | `onClose()` first, mutation in `setTimeout(fn, FADE_MS + 40)` |
| Must tap twice to dismiss | Card `Pressable` nested inside backdrop `Pressable` | Make backdrop and card siblings; absorb card taps with `onStartShouldSetResponder` |
| Popup vanishes instantly (no fade-out) | Unmounting on `visible=false` instead of after the animation | Gate render on `mounted`, set it false in the `finished` callback |
| Off-screen / scrolls with content | `absoluteFill` nested in a ScrollView | Render at screen root, or host in core `Modal` `animationType="none"` |
| Taps leak through to backdrop on empty card area | Card View doesn't claim the touch | `onStartShouldSetResponder={() => true}` on the card |

## Red flags — stop

- Importing `react-native-modal` (or `PopupModal`) for a new popup.
- Any `animationIn` / `animationOut` / `backdropTransitionOutTiming` prop — you're back on the flickering library.
- `await`ing or synchronously calling a `localApi` mutation inside the same handler that closes the popup, before the fade runs.
- A `Pressable` whose child is another `Pressable` acting as backdrop/card.
