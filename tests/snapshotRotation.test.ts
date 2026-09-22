import { describe, it, expect } from "vitest"
import {
  DAILY_SLOT_MS,
  META_MTIME_TOLERANCE_MS,
  planRotation,
  reconcileMeta,
  type RestoreMeta,
  type SlotInfo,
} from "../mobile/src/store/snapshotRotation"

const NOW = new Date("2026-09-21T18:00:00.000Z")

function info(msAgo: number, workouts = 10): SlotInfo {
  return {
    savedAt: new Date(NOW.getTime() - msAgo).toISOString(),
    workouts,
    sets: workouts * 20,
  }
}

const incoming = { savedAt: NOW.toISOString(), workouts: 12, sets: 240 }
const all = { current: true, bak: true, bak2: true }

describe("planRotation", () => {
  it("first write: nothing to rotate, current gets the incoming stats", () => {
    const plan = planRotation({}, { current: false, bak: false, bak2: false }, incoming, NOW)
    expect(plan.promote).toBe(false)
    expect(plan.meta).toEqual({ current: incoming })
  })

  it("second write: current moves to .bak, no daily slot yet", () => {
    const meta: RestoreMeta = { current: info(60_000) }
    const plan = planRotation(meta, { current: true, bak: false, bak2: false }, incoming, NOW)
    expect(plan.promote).toBe(false)
    expect(plan.meta).toEqual({ current: incoming, bak: meta.current })
  })

  it("fills an empty daily slot from .bak at once", () => {
    const meta: RestoreMeta = { current: info(30_000), bak: info(90_000) }
    const plan = planRotation(meta, { current: true, bak: true, bak2: false }, incoming, NOW)
    expect(plan.promote).toBe(true)
    expect(plan.meta.bak2).toEqual(meta.bak)
    expect(plan.meta.bak).toEqual(meta.current)
  })

  it("holds a daily slot younger than 24 hours; .bak is overwritten", () => {
    const meta: RestoreMeta = {
      current: info(30_000),
      bak: info(90_000),
      bak2: info(DAILY_SLOT_MS - 1),
    }
    const plan = planRotation(meta, all, incoming, NOW)
    expect(plan.promote).toBe(false)
    expect(plan.meta.bak2).toEqual(meta.bak2)
    expect(plan.meta.bak).toEqual(meta.current)
  })

  it("moves .bak into a daily slot that is 24 hours old", () => {
    const meta: RestoreMeta = {
      current: info(30_000),
      bak: info(90_000),
      bak2: info(DAILY_SLOT_MS),
    }
    const plan = planRotation(meta, all, incoming, NOW)
    expect(plan.promote).toBe(true)
    expect(plan.meta.bak2).toEqual(meta.bak)
  })

  it("treats a daily slot with an unreadable date as old", () => {
    const meta: RestoreMeta = {
      current: info(30_000),
      bak: info(90_000),
      bak2: { savedAt: "garbage", workouts: null, sets: null },
    }
    expect(planRotation(meta, all, incoming, NOW).promote).toBe(true)
  })

  it("holdDaily keeps an expired daily slot in place (restore path)", () => {
    const meta: RestoreMeta = {
      current: info(30_000),
      bak: info(90_000),
      bak2: info(3 * DAILY_SLOT_MS),
    }
    const plan = planRotation(meta, all, incoming, NOW, { holdDaily: true })
    expect(plan.promote).toBe(false)
    expect(plan.meta.bak2).toEqual(meta.bak2)
    expect(plan.meta.bak).toEqual(meta.current)
  })

  it("keeps the undo entry through a rotation", () => {
    const undo = info(5 * 60_000)
    const meta: RestoreMeta = { current: info(30_000), bak: info(90_000), bak2: info(1000), undo }
    expect(planRotation(meta, all, incoming, NOW).meta.undo).toEqual(undo)
  })

  it("records unknown counts when the caller passes no stats", () => {
    const plan = planRotation({}, { current: false, bak: false, bak2: false }, undefined, NOW)
    expect(plan.meta.current).toEqual({ savedAt: NOW.toISOString(), workouts: null, sets: null })
  })
})

describe("reconcileMeta", () => {
  const t = NOW.getTime()

  it("keeps an entry whose file was written just after its stats were taken", () => {
    const entry = info(0)
    const out = reconcileMeta({ bak: entry }, { bak: t + 2_000 })
    expect(out.bak).toEqual(entry)
  })

  it("replaces an entry that describes a different file (a kill before the metadata write)", () => {
    // The label says two days old; the file in the slot is minutes old.
    const out = reconcileMeta({ bak2: info(2 * DAILY_SLOT_MS) }, { bak2: t - 5 * 60_000 })
    expect(out.bak2).toEqual({
      savedAt: new Date(t - 5 * 60_000).toISOString(),
      workouts: null,
      sets: null,
    })
  })

  it("drops entries for files that are gone and adds entries for unlabelled files", () => {
    const out = reconcileMeta({ bak: info(0), undo: info(0) }, { current: t })
    expect(Object.keys(out)).toEqual(["current"])
    expect(out.current!.workouts).toBeNull()
  })

  it("draws the line at the tolerance", () => {
    const entry = info(0)
    expect(reconcileMeta({ bak: entry }, { bak: t + META_MTIME_TOLERANCE_MS }).bak).toEqual(entry)
    expect(reconcileMeta({ bak: entry }, { bak: t + META_MTIME_TOLERANCE_MS + 1 }).bak!.workouts).toBeNull()
  })
})
