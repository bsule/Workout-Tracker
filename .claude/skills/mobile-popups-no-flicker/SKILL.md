---
name: mobile-popups-no-flicker
description: Use when building or fixing any popup, modal, overlay, dropdown, picker, action sheet, or confirm dialog in the React Native (Expo) mobile app (mobile/) — especially if it flickers, flashes, stutters, double-animates, blinks on open/close, or needs a double tap to dismiss.
---

# Mobile Popups Without Flicker

## Overview

Every popup in `mobile/` is built from two shared pieces. Use them; do not hand-roll a new overlay.

- **`usePresence(visible, { inMs })`** in `src/anim/index.ts`. One native-driven opacity value, and a `mounted` flag that stays true until the fade-out has finished. Returns `{ mounted, opacity, hide }`. `hide()` drops the popup with no fade, for a dismiss caused by a navigation.
- **`OverlayCard`** in `src/components/OverlayCard.tsx`. The dimmed backdrop (tap to dismiss) and the card, as siblings. Also exports `overlayCardStyles` (`title`, `actions`, `input`, `scroll`).

Timing helpers live next to `usePresence`: `DUR.fade` (180 ms), `DUR.fadeFast` (150 ms), `ANIM_SLACK_MS` (40 ms), and `deferPastAnimation(fn, ms)`.

Reference implementations:
- `src/components/NoteSheet.tsx`: the note viewer and editor, used by DayScreen and SetLoggerScreen.
- `src/components/PopupModal.tsx`: a titled form card. Settings and Categories use it for their edit forms.
- `GymPickerModal` in `src/screens/DayScreen.tsx`: a picker with a list and an inline add row.
- `RecordDayPopup` in `src/screens/SetLoggerScreen.tsx`: a read-only card opened from inside a ScrollView.

## The rules

1. **No `react-native-modal` for a new popup.** Its backdrop transition and its card animation run on two timings, and that reads as a flash or a double animation. The only remaining user is `ExercisePickerSheet`; do not copy it. `PopupModal` no longer wraps it and is safe to use.
2. **Fade with `usePresence`**, and render nothing while `!mounted`. Never unmount on `visible=false`, or there is nothing left to fade.
3. **Backdrop and card are siblings, never nested.** `OverlayCard` does this. A card Pressable inside a backdrop Pressable needs two taps to dismiss.
4. **Claim touches on the card only when it holds a draft.** Pass `claimTouches` to `OverlayCard` for a form, so a stray tap beside an input does not dismiss it and lose the text. Leave it off for a read-only card: a JS responder on the card blocks the scroll gesture of any ScrollView inside it.
5. **Defer store mutations past the fade.** Call `onClose()` first, then run the `localApi` mutation in `deferPastAnimation(fn, DUR.fade)`. A mutation during the fade re-renders the screen behind the popup and the overlay stutters. This is the same root cause as the repo rule "do not await between a localApi mutation and a navigation".
6. **Disarm the backdrop during the entrance** if the popup can open from a tap near the backdrop area. `PopupModal` does this: `onBackdropPress` is undefined until `DUR.fade + ANIM_SLACK_MS` after opening.

## Canonical implementation

```tsx
import { OverlayCard, overlayCardStyles } from "../components/OverlayCard"
import { DUR, deferPastAnimation, usePresence } from "../anim"

function MyPopup({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { mounted, opacity } = usePresence(visible, { inMs: DUR.fade })

  function pick(value: string) {
    onClose()
    deferPastAnimation(() => api.someMutation(value), DUR.fade)
  }

  if (!mounted) return null

  return (
    <OverlayCard opacity={opacity} visible={visible} onBackdropPress={onClose}>
      <Text style={overlayCardStyles.title}>Title</Text>
      {/* option Pressables here, NOT wrapped in another Pressable */}
    </OverlayCard>
  )
}
```

`OverlayCard` props:
- `align`: `"top"` (default) pins the card near the top, so a keyboard does not cover it. Use `"center"` only for a read-only card with no input.
- `claimTouches`: see rule 4.
- `hostInModal`: see the next section.
- `visible`: gates touches, so a popup in its fade-out is inert.

**Render the popup at the screen root**, as a sibling of the screen's ScrollView. The overlay fills the viewport only when it is not inside scrolling content.

## Variant: popup defined inside a ScrollView

If the popup must live inside a ScrollView, pass `hostInModal` to `OverlayCard`. It hosts the overlay in the core `Modal` with `animationType="none"`, so it escapes the ScrollView while `usePresence` still drives the fade. See `RecordDayPopup` and `PopupModal`. Never give the core `Modal` its own `"fade"` animation: that reintroduces the flicker and swallows a tap on dismiss.

## Dropdown and overflow menus

Menus do not use `OverlayCard`. Use `MenuButton` (anchored to a trigger) or `MenuPopup` (controlled by a `visible` flag) from `src/components/MenuPopup.tsx`. Both show the system `Alert.alert`, centred on screen. A UIMenu opened from a nav-bar button covers that button on iOS 26, and the native menu module is gone from the dependencies.

Because an alert is gone before its button's `onPress` runs, a menu needs no fade, no deferral, and no armed backdrop. `onSelect` can mutate the store directly. An alert button has only a title, so `MenuAction`'s extra fields fold into it: a `subtitle` goes in parentheses, `selected` adds a check mark to the title, `icon` is ignored, and a `disabled` row is left off (its subtitle becomes the alert message).

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| Backdrop flashes on close | `react-native-modal` | `usePresence` + `OverlayCard` |
| Card stutters or double-animates on close | Store mutation during the fade | `onClose()` first, then `deferPastAnimation(fn, DUR.fade)` |
| Must tap twice to dismiss | Card Pressable nested in the backdrop Pressable | Use `OverlayCard`; it keeps them siblings |
| Popup vanishes with no fade-out | Unmounted on `visible=false` | Gate the render on `usePresence`'s `mounted` |
| ScrollView inside the card will not scroll | `claimTouches` on a read-only card | Turn `claimTouches` off |
| A tap beside the input dismisses the form | `claimTouches` off on a form card | Turn `claimTouches` on |
| Off-screen, or scrolls with the content | Overlay nested in a ScrollView | Render at the screen root, or pass `hostInModal` |
| The tap that opened it closes it again | Backdrop armed during the entrance | Disarm it until the fade lands (see `PopupModal`) |

## Red flags: stop

- Importing `react-native-modal` for a new popup.
- Any `animationIn`, `animationOut`, or `backdropTransitionOutTiming` prop.
- A hand-written `Animated.Value` fade and `mounted` state for a popup, instead of `usePresence`.
- A `localApi` mutation in the same handler that closes the popup, not deferred past the fade.
- A `Pressable` whose child is another `Pressable` acting as backdrop or card.
