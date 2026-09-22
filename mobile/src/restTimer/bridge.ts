import RestTimer, { type RestTimerInput } from "../../modules/rest-timer"

export type { RestTimerInput }

/** False in Expo Go and any host without the native module. */
export function isRestTimerAvailable(): boolean {
  return RestTimer != null
}

// Every call resolves; a missing module is the same as nothing showing.
// Errors still reject so the controller can log them.
export const restTimerBridge = {
  async start(input: RestTimerInput): Promise<void> {
    if (!RestTimer) return
    await RestTimer.start(input)
  },

  async update(input: RestTimerInput): Promise<void> {
    if (!RestTimer) return
    await RestTimer.update(input)
  },

  async end(): Promise<void> {
    if (!RestTimer) return
    await RestTimer.end()
  },

  async current(): Promise<RestTimerInput | null> {
    if (!RestTimer) return null
    return (await RestTimer.current()) ?? null
  },
}
