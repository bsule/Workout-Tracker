import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, StyleSheet, View } from "react-native"
import { MenuButton, type MenuAction } from "./MenuPopup"
import { EASE } from "../anim"
import { theme, line } from "../theme/theme"

const TIMER_MENU: MenuAction[] = [
  { id: "reset", title: "Reset timer" },
  { id: "stop", title: "Stop timer" },
]

/** The roll on Reset timer: the old time leaves upward, "0s" arrives from
 *  below. Short out, longer in, like a set row landing. */
const ROLL_OUT_MS = 120
const ROLL_IN_MS = 240
const ROLL_PX = 10
/** Stop timer: one motion. The line's height eases shut while its text
 *  fades a little faster, so the card and everything under it glide up
 *  together instead of waiting for a fade to finish. */
const STOP_MS = 300
const STOP_FADE_MS = 180
/** How long "0s" stays teal after a reset before settling back to muted. */
const TINT_MS = 700

/** Past this the user is presumed not mid-workout and the line is noise. */
const HIDE_AFTER_S = 1800

function elapsedS(anchorMs: number): number {
  return Math.max(0, Math.floor((Date.now() - anchorMs) / 1000))
}

/**
 * The set logger's ticking "Xs since last set" / "Xm Ys since last set"
 * line. A tap opens Reset timer / Stop timer, each with its own motion.
 * `anchorMs` is what it counts from (tickerAnchor in restTimer/plan.ts);
 * null means there is nothing to count from.
 *
 * The parent keeps this mounted and the line hides itself, so that losing
 * the anchor (deleting the set it counted from, the 30 minute cutoff) shuts
 * the line with the same motion as Stop timer instead of dropping it in one
 * frame.
 */
export function RestTicker({
  anchorMs,
  onReset,
  onStop,
}: {
  anchorMs: number | null
  onReset: () => void
  onStop: () => void
}) {
  const shown = anchorMs != null && elapsedS(anchorMs) <= HIDE_AFTER_S
  // True once the line has fully shut and renders nothing.
  const [closed, setClosed] = useState(!shown)
  // What the label counts from while the line shuts: the last anchor it
  // showed. Deleting the newest set can hand over an older set past the
  // cutoff, and counting from that would flash its time on the way out.
  const lastAnchor = useRef(shown ? anchorMs : null)
  if (shown) lastAnchor.current = anchorMs

  // Re-renders 10x/sec; the displayed value reads Date.now() at render time
  // (NOT captured state), so any momentary JS-thread stall during a
  // mutation/persist can only delay the visible second-flip by up to
  // ~100ms before the next tick re-reads the clock. Keyed on `closed` only,
  // so the interval stays alive across anchorMs changes. A shut line only
  // opens again on a new anchor, which is a prop change, so it needs no tick.
  const [, force] = useState(0)
  useEffect(() => {
    if (closed) return
    const id = setInterval(() => force((c) => c + 1), 100)
    return () => clearInterval(id)
  }, [closed])

  // Opacity and translateY on the native driver. The tint is a color, which
  // the native driver cannot animate, so it lives on the inner Text alone.
  const opacity = useRef(new Animated.Value(1)).current
  const shiftY = useRef(new Animated.Value(0)).current
  const tint = useRef(new Animated.Value(0)).current
  // Stop collapses the line's own height (JS driver: layout cannot run on
  // the native one). `measured` is the resting height, read from layout;
  // the height style only applies once `collapsing` is set.
  const measured = useRef(0)
  const collapse = useRef(new Animated.Value(1)).current
  const [collapsing, setCollapsing] = useState(false)
  // A second pick while one motion is running would stack the two.
  const busy = useRef(false)
  // Set once Stop has shut the line. The anchor normally goes null then and
  // the line stays shut, but a set whose created_at is later than the stop
  // (synced from a device with a fast clock) keeps it on screen at zero
  // height. The next anchor is a newly saved set, so open the line again
  // for it.
  const stopped = useRef(false)
  useEffect(() => {
    // A null anchor is Stop landing; the effect below keeps the line shut.
    if (!stopped.current || anchorMs == null) return
    stopped.current = false
    opacity.setValue(1)
    shiftY.setValue(0)
    collapse.setValue(1)
    setCollapsing(false)
  }, [anchorMs, opacity, shiftY, collapse])

  // Leaving the screen mid-motion stops every animation. The chosen action
  // still happens: a stopped animation calls its completion handler, which
  // runs onStop / onReset, and `alive` keeps the reset from starting the
  // roll-in on a line that is gone.
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
      for (const v of [opacity, shiftY, tint, collapse]) v.stopAnimation()
    },
    [opacity, shiftY, tint, collapse]
  )

  const leave = useCallback(
    (ms: number, toY: number) =>
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: ms, easing: EASE.in, useNativeDriver: true }),
        Animated.timing(shiftY, { toValue: toY, duration: ms, easing: EASE.in, useNativeDriver: true }),
      ]),
    [opacity, shiftY]
  )
  // The Stop timer motion, also used when the anchor goes away on its own.
  const shut = useCallback(() => {
    setCollapsing(true)
    return Animated.parallel([
      Animated.timing(collapse, {
        toValue: 0,
        duration: STOP_MS,
        easing: EASE.inOut,
        useNativeDriver: false,
      }),
      leave(STOP_FADE_MS, -ROLL_PX / 2),
    ])
  }, [collapse, leave])

  // The anchor went away (its set was deleted, or 30 minutes passed): shut
  // the line like Stop timer. A new anchor opens it again at rest, with no
  // motion, the same as a line that mounts.
  const hiding = useRef(false)
  useEffect(() => {
    if (shown) {
      if (!closed && !hiding.current) return
      hiding.current = false
      stopped.current = false
      busy.current = false
      collapse.stopAnimation()
      opacity.setValue(1)
      shiftY.setValue(0)
      collapse.setValue(1)
      setCollapsing(false)
      setClosed(false)
      return
    }
    if (closed || hiding.current) return
    hiding.current = true
    // Stop timer already shut it; the null anchor is that landing.
    if (stopped.current) {
      setClosed(true)
      return
    }
    busy.current = true
    shut().start(({ finished }) => {
      // Not finished: a new anchor reopened the line mid-motion, or the
      // screen is leaving.
      if (!finished || !hiding.current) return
      setClosed(true)
    })
  }, [shown, closed, shut, opacity, shiftY, collapse])

  const onSelect = useCallback(
    (id: string) => {
      if (id !== "reset" && id !== "stop") return
      if (busy.current) return
      busy.current = true
      if (id === "stop") {
        shut().start(() => {
          busy.current = false
          stopped.current = true
          // Already zero height, so dropping the line moves nothing.
          onStop()
        })
        return
      }
      leave(ROLL_OUT_MS, -ROLL_PX).start(() => {
        // Reset between the two halves, so "0s" is what rolls in and the
        // old time never flashes back.
        onReset()
        if (!alive.current) return
        shiftY.setValue(ROLL_PX)
        tint.setValue(1)
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: ROLL_IN_MS, easing: EASE.out, useNativeDriver: true }),
          Animated.timing(shiftY, { toValue: 0, duration: ROLL_IN_MS, easing: EASE.out, useNativeDriver: true }),
        ]).start(() => {
          busy.current = false
        })
        Animated.timing(tint, {
          toValue: 0,
          duration: TINT_MS,
          delay: ROLL_IN_MS,
          easing: EASE.inOut,
          useNativeDriver: false,
        }).start()
      })
    },
    [opacity, shiftY, tint, leave, shut, onReset, onStop]
  )

  if (closed || lastAnchor.current == null) return null
  const elapsed = elapsedS(lastAnchor.current)
  let label: string
  if (elapsed < 60) {
    label = `${elapsed}s`
  } else {
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    label = `${m}m ${s}s`
  }
  const color = tint.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.muted, theme.colors.secondary],
  })
  return (
    <Animated.View
      onLayout={(e) => {
        if (!collapsing) measured.current = e.nativeEvent.layout.height
      }}
      style={
        collapsing
          ? {
              overflow: "hidden",
              height: collapse.interpolate({
                inputRange: [0, 1],
                outputRange: [0, measured.current],
              }),
            }
          : undefined
      }
    >
      <MenuButton title="Rest timer" actions={TIMER_MENU} onSelect={onSelect}>
        <View style={styles.row}>
          <Animated.View style={{ opacity, transform: [{ translateY: shiftY }] }}>
            <Animated.Text style={[styles.text, { color }]}>
              {label} since last set
            </Animated.Text>
          </Animated.View>
        </View>
      </MenuButton>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 6,
    paddingHorizontal: theme.spacing[3],
    borderTopColor: line(0.06),
    borderTopWidth: StyleSheet.hairlineWidth,
    // Clips the Reset timer roll to the line, like a counter wheel.
    overflow: "hidden",
  },
  text: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
})
