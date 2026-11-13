import { describe, expect, it } from "vitest"
import {
  SetSaveQueue,
  type SaveQueueApi,
  type TapSet,
} from "../mobile/src/setLogger/saveQueue"

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tap = (key: number, weight = 100, reps = 5): TapSet => ({
  key,
  weight,
  reps,
  createdAt: new Date(key).toISOString(),
})

function harness(resolved: { workoutId: number; weId: number } | null = null) {
  const calls: string[] = []
  const events = { resolved: [] as unknown[], predicted: [] as unknown[], failed: [] as number[] }
  const firstSave = deferred<{ workout_id: number; we_id: number }>()
  const api: SaveQueueApi = {
    logSet: (date, exerciseId, input) => {
      calls.push(`log_set:${date}:${exerciseId}:${input.created_at}`)
      return firstSave.promise
    },
    addSet: async (weId, input) => {
      calls.push(`add_set:${weId}:${input.created_at}`)
    },
    predictPr: async (exerciseId, weId, weight, reps, queued) => {
      calls.push(`predict:${weId}:${weight}x${reps}:queued=${queued.map((q) => `${q.weight}x${q.reps}`).join(",")}`)
      return { isPr: queued.length === 0, isPosPr: false, position: queued.length + 1 }
    },
  }
  const queue = new SetSaveQueue(
    api,
    {
      onResolved: (ids) => events.resolved.push(ids),
      onPredicted: (key, p) => events.predicted.push({ key, ...p }),
      onFailed: (key) => events.failed.push(key),
    },
    () => ({ exerciseId: 7, date: "2026-03-01" }),
    resolved
  )
  return { queue, calls, events, firstSave }
}

describe("SetSaveQueue", () => {
  it("makes one log_set for a fast double tap and adds the second set to its row", async () => {
    const { queue, calls, events, firstSave } = harness()
    queue.tap(tap(1))
    const first = queue.write([tap(1)])
    queue.tap(tap(2))
    const second = queue.write([tap(2)])
    await new Promise((r) => setTimeout(r, 0))
    // The second tap waits for the first save: no second log_set.
    expect(calls).toEqual([`log_set:2026-03-01:7:${new Date(1).toISOString()}`])
    firstSave.resolve({ workout_id: 3, we_id: 9 })
    await first
    await second
    // The second tap's preview waited for the row and ranks against it.
    expect(calls).toEqual([
      `log_set:2026-03-01:7:${new Date(1).toISOString()}`,
      "predict:9:100x5:queued=",
      `add_set:9:${new Date(2).toISOString()}`,
    ])
    expect(events.resolved).toEqual([{ workoutId: 3, weId: 9 }])
    expect(queue.ids).toEqual({ workoutId: 3, weId: 9 })
    expect(queue.pending).toEqual([])
  })

  it("reports a failed first save for its tap only, and the next tap tries log_set again", async () => {
    const { queue, calls, events, firstSave } = harness()
    queue.tap(tap(1))
    const first = queue.write([tap(1)])
    firstSave.reject(new Error("disk full"))
    await first
    expect(events.failed).toEqual([1])
    expect(queue.ids).toBeNull()
    expect(queue.pending).toEqual([])
    queue.tap(tap(2))
    // A fresh deferred is not needed: the rejected promise is reused, so the
    // second attempt fails too, but it is attempted.
    await queue.write([tap(2)])
    expect(calls.filter((c) => c.startsWith("log_set"))).toHaveLength(2)
    expect(events.failed).toEqual([1, 2])
  })

  it("keeps a failed add for that tap and still writes the later ones", async () => {
    const failed: number[] = []
    let n = 0
    const failing = new SetSaveQueue(
      {
        logSet: async () => ({ workout_id: 0, we_id: 0 }),
        addSet: async () => {
          if (n++ === 0) throw new Error("closed")
        },
        predictPr: async () => ({ isPr: false, isPosPr: false, position: 1 }),
      },
      {
        onResolved: () => {},
        onPredicted: () => {},
        onFailed: (key) => failed.push(key),
      },
      () => ({ exerciseId: 7, date: null }),
      { workoutId: 3, weId: 9 }
    )
    failing.tap(tap(1), false)
    failing.tap(tap(2), false)
    await failing.write([tap(1), tap(2)])
    expect(failed).toEqual([1])
    expect(n).toBe(2)
    expect(failing.pending).toEqual([])
  })

  it("counts earlier taps that are not written yet in the PR preview, and only those", async () => {
    const { queue, calls, events } = harness({ workoutId: 3, weId: 9 })
    // Two taps before either write: the second sees the first as queued.
    await queue.tap(tap(1))
    await queue.tap(tap(2))
    expect(calls).toEqual([
      "predict:9:100x5:queued=",
      "predict:9:100x5:queued=100x5",
    ])
    expect(events.predicted).toEqual([
      { key: 1, isPr: true, isPosPr: false, position: 1 },
      { key: 2, isPr: false, isPosPr: false, position: 2 },
    ])
    // Once both are written they are in the engine, so a third tap counts
    // neither of them again.
    await queue.write([tap(1), tap(2)])
    await queue.tap(tap(3, 110, 5))
    expect(calls.at(-1)).toBe("predict:9:110x5:queued=")
  })

  it("previews no PR before the first save has made the exercise row", async () => {
    const { queue, calls, events } = harness()
    await queue.tap(tap(1))
    expect(calls).toEqual([])
    expect(events.predicted).toEqual([])
  })

  it("runs a preview queued behind the first save against the row it made", async () => {
    const { queue, calls, events, firstSave } = harness()
    queue.tap(tap(1), false)
    const first = queue.write([tap(1)])
    const preview = queue.tap(tap(2))
    firstSave.resolve({ workout_id: 3, we_id: 9 })
    await first
    await preview
    expect(calls.at(-1)).toBe("predict:9:100x5:queued=")
    expect(events.predicted).toHaveLength(1)
  })
})
