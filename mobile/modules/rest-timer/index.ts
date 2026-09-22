import { requireOptionalNativeModule } from "expo-modules-core"

/** Times are epoch milliseconds. */
export interface RestTimerInput {
  exerciseName: string
  startedAt: number
  endsAt: number
}

interface NativeModule {
  /** Replaces whatever timer is showing with a new one. */
  start(input: RestTimerInput): Promise<void>
  /** Changes the timer that is showing in place, with no start animation.
   *  Starts one when nothing is showing (the user can swipe it away). */
  update(input: RestTimerInput): Promise<void>
  /** Removes the timer. Resolves with no action when nothing is showing. */
  end(): Promise<void>
  /** The timer the OS reports as showing, or null. It can come from an
   *  earlier process of the app. */
  current(): Promise<RestTimerInput | null>
}

// Returns null in Expo Go (no custom native code can load there). Callers
// MUST handle the null case; mobile/src/restTimer/bridge.ts does.
const native = requireOptionalNativeModule<NativeModule>("RestTimerModule")

export default native
