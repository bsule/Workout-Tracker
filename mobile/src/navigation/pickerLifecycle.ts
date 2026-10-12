import type { createPickerSelectionGuard } from "./workoutPickerGuard"

type TransitionEvent = { data?: { closing: boolean } }
interface PickerNavigation {
  addListener(event: "transitionStart" | "transitionEnd" | "gestureCancel", listener: (event: TransitionEvent) => void): () => void
}

/** Uses native completion/cancellation events, including on a preloaded screen. */
export function bindPickerInteraction(
  navigation: PickerNavigation,
  guard: ReturnType<typeof createPickerSelectionGuard>,
  setInteractive: (ready: boolean) => void,
  frames: { request(callback: () => void): number; cancel(id: number): void; now(): number },
) {
  let settled = false
  let frame: number | undefined
  let generation = 0
  let disposed = false

  const pause = () => {
    generation++
    if (frame !== undefined) frames.cancel(frame)
    frame = undefined
    guard.block()
    setInteractive(false)
  }
  const rearm = () => {
    pause()
    if (!settled || disposed) return
    const currentGeneration = generation
    frame = frames.request(() => {
      if (disposed || !settled || generation !== currentGeneration) return
      frame = undefined
      guard.ready(frames.now())
      setInteractive(true)
    })
  }
  const block = () => {
    settled = false
    pause()
  }
  const resume = () => {
    settled = true
    rearm()
  }

  block()
  const stops = [
    navigation.addListener("transitionStart", block),
    navigation.addListener("transitionEnd", (event) => {
      if (event.data?.closing === false) resume()
    }),
    // iOS emits this instead of onAppear/transitionEnd after a cancelled swipe.
    navigation.addListener("gestureCancel", resume),
  ]
  return {
    block,
    rearm,
    dispose() {
      disposed = true
      block()
      for (const stop of stops) stop()
    },
  }
}

interface PreloadNavigation {
  isFocused(): boolean
  getState(): { preloadedRoutes?: readonly { name: string }[] }
  preload(name: string): void
  addListener(event: "transitionEnd" | "blur", listener: (event: TransitionEvent) => void): () => void
}

/** Mount the entire picker while Main is idle, and warm a fresh one after a pop. */
export function bindPickerPreload(
  navigation: PreloadNavigation,
  idle: { request(callback: () => void): number; cancel(id: number): void },
) {
  let pending: number | undefined
  let disposed = false
  const cancel = () => {
    if (pending !== undefined) idle.cancel(pending)
    pending = undefined
  }
  const prepare = () => {
    if (disposed || pending !== undefined || !navigation.isFocused()) return
    if (navigation.getState().preloadedRoutes?.some((route) => route.name === "ExercisePicker")) return
    pending = idle.request(() => {
      pending = undefined
      if (disposed || !navigation.isFocused()) return
      navigation.preload("ExercisePicker")
    })
  }
  const stops = [
    navigation.addListener("blur", cancel),
    navigation.addListener("transitionEnd", (event) => {
      if (event.data?.closing === false) prepare()
    }),
  ]
  prepare()
  return () => {
    disposed = true
    cancel()
    for (const stop of stops) stop()
  }
}
