/**
 * The app's animation vocabulary: durations, easings, the LayoutAnimation
 * configs, and the four hooks that the screens kept re-implementing.
 *
 * Why this file exists. Every screen wrote the same four shapes by hand:
 *
 *  1. Run one `Animated.Value` from a boolean, and stop it on unmount.
 *  2. Fade a popup in, then keep it mounted until the fade-out finishes.
 *  3. Flip a chevron while a `LayoutAnimation` eases the container's height.
 *  4. Hold a store mutation back until an animation has finished.
 *
 * Each one had drifted: two spellings of the same list animation, two copies
 * of the note sheet, three copies of the Android enable flag. The durations
 * and easings here are the values those call sites already used, so nothing
 * on screen changes - there is now one definition of each instead of nine.
 *
 * What is deliberately NOT here: any animation whose effect body carries real
 * logic. The set logger's form/selection-bar swap, the record card's measured
 * height, and the set row's exit all time themselves against a specific store
 * commit. A shared hook would have to take those timings as options, which is
 * how a helper ends up longer than the code it replaced.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native"

type EasingFn = (value: number) => number
/** What `LayoutAnimation.configureNext` accepts, named so hooks can take one. */
export type LayoutConfig = Parameters<typeof LayoutAnimation.configureNext>[0]

/**
 * Durations, in milliseconds. Grouped by what the user is waiting for, not by
 * the component that happens to use them.
 */
export const DUR = {
  /** A popup's backdrop + card fade. */
  fade: 180,
  /** A popup that sits over a scroll view and has to feel lighter. */
  fadeFast: 150,
  /** A chevron's half turn. */
  spin: 240,
  /** A selected-state wash arriving. */
  highlightIn: 110,
  /** ...and leaving. Shorter: the user has already moved on. */
  highlightOut: 90,
  /** An element collapsing its own width away inside a row. */
  collapseIn: 130,
  collapseOut: 110,
  /** A bar that replaces another bar in place. */
  barIn: 150,
  barOut: 100,
  /** A note line appearing, and the container height that moves with it. */
  noteReveal: 260,
  /** A note line going. Leaving needs less ceremony than arriving. */
  noteHide: 180,
  /** A changed number's pop settling back to its size (an edited set's
   *  weight or reps in the list). */
  changePop: 220,
  /** ...and its teal fading back to the normal color. Matches the rest
   *  ticker's teal after a reset. */
  changeTint: 700,
} as const

/**
 * Easings. `out` for anything arriving (it spends the visible part of the
 * motion up front), `in` for anything leaving, `inOut` for a transition
 * between two resting states where neither end is an entrance.
 */
export const EASE = {
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  /** A softer tail than `out`, for an exit that must be seen but not felt. */
  outSoft: Easing.out(Easing.quad),
} as const

// ---- LayoutAnimation ------------------------------------------------

/**
 * iOS has LayoutAnimation on by default; Android needs the flag. Idempotent,
 * and called from this module's load so every config below can be used
 * without each screen repeating the check (three of them used to).
 */
export function enableLayoutAnimations() {
  if (
    Platform.OS === "android" &&
    UIManager.setLayoutAnimationEnabledExperimental
  ) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
  }
}
enableLayoutAnimations()

/**
 * Rows arriving in and leaving a list: saved gyms, categories. Fades the row
 * while its neighbours slide, which reads as one motion.
 *
 * `scaleXY` is wrong for a full-width row - it scales toward a corner, so the
 * row appears to fly in from the side. That is why these use `opacity`.
 */
export const LIST_ANIM = {
  duration: 240,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 240,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: 240,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 200,
  },
} as const

/**
 * Content expanding and collapsing in place: a collapsible note, a "show all"
 * list. Revealed content fades in while the container's height eases.
 *
 * Safe to use `opacity` here only where no native-driven `Animated` node is
 * mounted nearby. The set logger's swipeable rows have one (the Swipeable's
 * `dragX`), and a JS-driven opacity on the same view throws at runtime - which
 * is why the set list uses SET_ANIM below instead.
 */
export const EXPAND_ANIM = {
  duration: 260,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 240,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: 260,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
    duration: 160,
  },
} as const

/**
 * Set rows arriving in and leaving the logger's list. A soft spring in (alive
 * without bouncing), and `easeInEaseOut` on both `delete` and `update` so a
 * removed row's collapse and the shift of the rows under it are one motion,
 * matched to the row's own opacity + translateY exit (~180ms).
 *
 * `scaleXY`, not `opacity`, and this is the reason the distinction exists at
 * all: LayoutAnimation runs on the JS driver, and a set row contains a legacy
 * Swipeable whose `progress` / `dragX` values are native-driven and bound to
 * the opacities and transforms of views inside the row. Animating `opacity`
 * here collides with those native nodes and throws at runtime ("Attempting to
 * run JS driven animation on animated node that has been moved to native").
 * `scaleXY` looks the same on these rows and shares no binding.
 */
export const SET_ANIM = {
  duration: 220,
  create: {
    type: LayoutAnimation.Types.spring,
    springDamping: 0.78,
    property: LayoutAnimation.Properties.scaleXY,
    duration: 260,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: 220,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
    duration: 180,
  },
} as const

/**
 * The layout half of a note appearing: the container grows and everything
 * under it shifts down. Configure it right before the mutation that writes
 * the note, so the height change lands in that same commit.
 *
 * No `create`, on purpose: the note line is a newly created view and keeps its
 * own fade-in (see NoteReveal). `delete` uses `scaleXY` rather than `opacity`
 * for the reason in EXPAND_ANIM - these run over the swipeable set rows.
 */
export const NOTE_SHIFT_ANIM = {
  duration: DUR.noteReveal,
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: DUR.noteReveal,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.scaleXY,
    duration: DUR.noteHide,
  },
} as const

/**
 * NOTE_SHIFT_ANIM without the `delete` section: only views that already exist
 * animate. For a commit that mounts a new row and must leave both that row and
 * anything being removed to their own animations.
 */
export const SHIFT_ANIM = {
  duration: DUR.noteReveal,
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    duration: DUR.noteReveal,
  },
} as const

// ---- hooks ----------------------------------------------------------

/**
 * Drive one `Animated.Value` from a boolean.
 *
 * Replaces the `useEffect` + `Animated.timing(...).start()` + `return () =>
 * a.stop()` block that appeared at eight call sites. The animation restarts
 * only when the boolean actually flips, so a re-render that leaves `on`
 * unchanged no longer restarts a timing from its current position.
 *
 * `onRest` receives whether the animation finished and which direction it was
 * going, for a caller that unmounts something once the exit has played.
 */
export function useToggleTiming(
  value: Animated.Value,
  on: boolean,
  opts: {
    inMs: number
    /** Defaults to `inMs`. */
    outMs?: number
    easeIn?: EasingFn
    /** Defaults to `easeIn`. */
    easeOut?: EasingFn
    /** False for layout properties (height, width), which cannot leave JS. */
    native?: boolean
    onRest?: (finished: boolean, on: boolean) => void
  }
) {
  const {
    inMs,
    outMs = inMs,
    easeIn = EASE.out,
    easeOut = easeIn,
    native = true,
    onRest,
  } = opts
  // Read through a ref so a fresh closure from the parent's render does not
  // restart the animation.
  const restRef = useRef(onRest)
  restRef.current = onRest
  useEffect(() => {
    const animation = Animated.timing(value, {
      toValue: on ? 1 : 0,
      duration: on ? inMs : outMs,
      easing: on ? easeIn : easeOut,
      useNativeDriver: native,
    })
    animation.start(({ finished }) => restRef.current?.(finished, on))
    return () => animation.stop()
  }, [value, on, inMs, outMs, easeIn, easeOut, native])
}

/**
 * Mount / fade / unmount for a popup.
 *
 * A popup cannot unmount on the frame it is dismissed, or there is nothing
 * left to fade. This keeps it mounted through the fade-out and drops it when
 * the fade lands. Every overlay in the app was doing this by hand.
 *
 * `hide()` is the escape hatch for leaving without a fade - when the popup is
 * dismissed by a navigation, fading it out over the incoming screen would put
 * a dimmed backdrop on top of the push.
 */
export function usePresence(
  visible: boolean,
  opts: { inMs?: number; outMs?: number } = {}
): { mounted: boolean; opacity: Animated.Value; hide: () => void } {
  const { inMs = DUR.fade, outMs = inMs } = opts
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) {
      setMounted(true)
      Animated.timing(opacity, {
        toValue: 1,
        duration: inMs,
        easing: EASE.out,
        useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: outMs,
      easing: EASE.in,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Guarded on `finished` so a reopen inside the fade-out cannot blank
      // the content that just came back.
      if (finished) setMounted(false)
    })
  }, [visible, opacity, inMs, outMs])

  const hide = useCallback(() => {
    opacity.stopAnimation()
    opacity.setValue(0)
    setMounted(false)
  }, [opacity])

  return { mounted, opacity, hide }
}

/**
 * Open / closed state for a section that expands in place, with the chevron
 * and the container's height change already wired together.
 *
 * Pass `spin` to SpinChevron. `reset()` closes without animating, for a
 * section whose content changed shape under it.
 */
export function useExpandToggle(config: LayoutConfig = EXPAND_ANIM): {
  open: boolean
  toggle: () => void
  reset: () => void
  spin: Animated.Value
} {
  const [open, setOpen] = useState(false)
  const spin = useRef(new Animated.Value(0)).current

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(config)
    setOpen((v) => {
      Animated.timing(spin, {
        toValue: v ? 0 : 1,
        duration: DUR.spin,
        easing: EASE.out,
        useNativeDriver: true,
      }).start()
      return !v
    })
  }, [spin, config])

  const reset = useCallback(() => {
    setOpen(false)
    spin.setValue(0)
  }, [spin])

  return { open, toggle, reset, spin }
}

/**
 * One extra frame of slack past an animation's own duration.
 *
 * Every popup in the app defers its store mutation past its fade, because a
 * snapshot commit re-renders the screen behind the popup and a JS-driven
 * animation stalls while that render blocks the thread. The animation's
 * duration alone is not enough of a wait: the last frame has to be presented
 * before the thread is taken. Hence the extra frame.
 */
export const ANIM_SLACK_MS = 40

export function deferPastAnimation(fn: () => void, ms: number) {
  setTimeout(fn, ms + ANIM_SLACK_MS)
}
