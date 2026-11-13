/**
 * The set logger's write queue, kept free of React and React Native so its
 * ordering can be pinned in tests (tests/setLoggerSaveQueue.test.ts).
 *
 * Every tap on Save shows its row at once (a placeholder in the screen) and
 * hands the set here. Steps run one at a time, in the order they arrive:
 *
 * - A PR prediction for a tap runs as soon as the tap lands. It counts the
 *   earlier taps whose write has not run yet as queued efforts, and only
 *   those: a set already written is in the engine and must not count twice.
 *   So a second 100x5 tapped before the first one saves is no PR.
 * - Writes run in batches, after the screen's own delay (see save()). The
 *   first set on a new exercise is one `log_set` command: it reuses the day's
 *   workout and the exercise row if they exist and creates them otherwise.
 *   Taps that arrive while it is in flight wait behind it and are added to
 *   the exercise row it returns, so a fast double tap never makes a second
 *   row.
 * - A failed write is reported for its tap alone, so the screen can drop
 *   that placeholder and tell the user. Later taps still run; while no
 *   exercise row exists, the next one tries `log_set` again.
 */

export interface TapSet {
  /** The placeholder's key in the screen (the tap time, kept unique). */
  key: number
  weight: number
  reps: number
  /** The tap time: the row, the in-app ticker and the Live Activity share it. */
  createdAt: string
}

export interface ResolvedIds {
  workoutId: number
  weId: number
}

export interface PrPrediction {
  isPr: boolean
  isPosPr: boolean
  position: number
}

export interface SaveQueueApi {
  logSet(
    date: string,
    exerciseId: number,
    input: { weight: number; reps: number; created_at: string }
  ): Promise<{ workout_id: number; we_id: number }>
  addSet(
    weId: number,
    input: { weight: number; reps: number; created_at: string }
  ): Promise<unknown>
  predictPr(
    exerciseId: number,
    weId: number,
    weight: number,
    reps: number,
    queued: readonly { weight: number; reps: number }[]
  ): Promise<PrPrediction>
}

export interface SaveQueueEvents {
  /** The first save created (or found) the workout and its exercise row. */
  onResolved(ids: ResolvedIds): void
  onPredicted(key: number, prediction: PrPrediction): void
  onFailed(key: number, error: unknown): void
}

export class SetSaveQueue {
  private chain: Promise<void> = Promise.resolve()
  /** Tapped, write not finished, oldest first. */
  private unwritten: TapSet[] = []
  private resolved: ResolvedIds | null

  constructor(
    private api: SaveQueueApi,
    private events: SaveQueueEvents,
    /** Read at each step: the screen learns the exercise id as data loads. */
    private target: () => { exerciseId: number | null; date: string | null },
    resolved: ResolvedIds | null
  ) {
    this.resolved = resolved
  }

  get ids(): ResolvedIds | null {
    return this.resolved
  }

  /** The screen learned the ids another way (opened on an existing row). */
  setResolved(ids: ResolvedIds | null) {
    if (ids) this.resolved = ids
  }

  /** Taps whose write has not finished. */
  get pending(): readonly TapSet[] {
    return this.unwritten
  }

  /** Whether any step is queued or running. */
  get busy(): boolean {
    return this.steps > 0
  }

  private steps = 0

  private run(step: () => Promise<void>): Promise<void> {
    this.steps++
    const next = this.chain.then(step).finally(() => {
      this.steps--
    })
    this.chain = next.catch(() => {})
    return next
  }

  /** Record a tap. Its write is queued later with write(). */
  tap(set: TapSet, predict = true): Promise<void> {
    this.unwritten.push(set)
    if (!predict) return Promise.resolve()
    return this.run(async () => {
      const ids = this.resolved
      const exerciseId = this.target().exerciseId
      // Before the first save there is no exercise row to rank against. The
      // row's own flags arrive with it, as they always have on a first set.
      if (!ids || exerciseId == null) return
      if (!this.unwritten.some((s) => s.key === set.key)) return
      const queued: { weight: number; reps: number }[] = []
      for (const s of this.unwritten) {
        if (s.key === set.key) break
        queued.push({ weight: s.weight, reps: s.reps })
      }
      try {
        const prediction = await this.api.predictPr(exerciseId, ids.weId, set.weight, set.reps, queued)
        this.events.onPredicted(set.key, prediction)
      } catch {
        // A failed preview only costs the early star; the saved row has its
        // own flags.
      }
    })
  }

  /** Write tapped sets, in tap order. */
  write(sets: readonly TapSet[]): Promise<void> {
    if (sets.length === 0) return Promise.resolve()
    return this.run(async () => {
      for (const set of sets) {
        const input = { weight: set.weight, reps: set.reps, created_at: set.createdAt }
        try {
          const ids = this.resolved
          if (ids) {
            await this.api.addSet(ids.weId, input)
          } else {
            const { date, exerciseId } = this.target()
            if (date == null || exerciseId == null) throw new Error("Nothing to log this set to.")
            const result = await this.api.logSet(date, exerciseId, input)
            this.resolved = { workoutId: result.workout_id, weId: result.we_id }
            this.events.onResolved(this.resolved)
          }
        } catch (error) {
          this.events.onFailed(set.key, error)
        } finally {
          this.unwritten = this.unwritten.filter((s) => s.key !== set.key)
        }
      }
    })
  }
}
