import { describe, expect, it } from "vitest"
import {
  cleanNumericText,
  createdAtForRest,
  deleteSetsTitle,
  historyDaysThrough,
  isCardioCategory,
  lastSessionBefore,
  lastSessionSummary,
  lastTimeCardOpen,
  latestOtherSetIso,
  matchPendingAdds,
  nextSetPosition,
  plannedSetTitle,
  restAnchorForEdit,
  restSecondsFrom,
  seedSetForm,
  setFormError,
  setPrBadge,
  setRestLabels,
} from "@lift/core/setLogger"
import type { ExerciseHistoryDay, HistorySet, WorkoutSet } from "@lift/core"

// These rules were lifted from mobile's SetLoggerScreen so the web logger
// follows them. The expectations pin mobile's behavior, which is the reference.

function set(p: Partial<WorkoutSet> & { id: number }): WorkoutSet {
  return {
    weight: 100,
    reps: 5,
    distance_m: null,
    distance_unit_display: "",
    time_seconds: null,
    is_pr: false,
    was_pr: false,
    is_position_pr: false,
    was_position_pr: false,
    note: "",
    order: p.id,
    is_planned: false,
    created_at: "2026-09-24T10:00:00.000Z",
    ...p,
  }
}

function hs(p: Partial<HistorySet> & { id: number }): HistorySet {
  return set(p) as unknown as HistorySet
}

function day(date: string, sets: HistorySet[]): ExerciseHistoryDay {
  return { date, note: "", sets }
}

describe("isCardioCategory", () => {
  it("is decided by the category", () => {
    expect(isCardioCategory("cardio")).toBe(true)
    expect(isCardioCategory("chest")).toBe(false)
    expect(isCardioCategory(null)).toBe(false)
  })
})

describe("seedSetForm", () => {
  const history = [
    day("2026-09-24", [hs({ id: 90, weight: 200, reps: 1 })]),
    day("2026-09-20", [
      hs({ id: 1, weight: 80, reps: 10 }),
      hs({ id: 2, weight: 90, reps: 6 }),
    ]),
  ]

  it("prefers the next planned target when logging", () => {
    const sets = [set({ id: 1, weight: 50, reps: 3 }), set({ id: 2, weight: 60, reps: 4, is_planned: true })]
    expect(
      seedSetForm({ sets, isPlanned: false, history, workoutDate: "2026-09-24", isCardio: false })
    ).toEqual({ weight: 60, reps: 4 })
  })

  it("uses the last set while authoring a planned workout", () => {
    const sets = [set({ id: 1, weight: 60, reps: 4, is_planned: true }), set({ id: 2, weight: 70, reps: 2, is_planned: true })]
    expect(
      seedSetForm({ sets, isPlanned: true, history, workoutDate: "2026-09-24", isCardio: false })
    ).toEqual({ weight: 70, reps: 2 })
  })

  it("falls back to the last session's top set, skipping the current day", () => {
    expect(
      seedSetForm({ sets: [], isPlanned: false, history, workoutDate: "2026-09-24", isCardio: false })
    ).toEqual({ weight: 90, reps: 6 })
  })

  it("defaults to 0 x 8, or 20 min at Level 5 for cardio", () => {
    expect(
      seedSetForm({ sets: [], isPlanned: false, history: [], workoutDate: "2026-09-24", isCardio: false })
    ).toEqual({ weight: 0, reps: 8 })
    expect(
      seedSetForm({ sets: [], isPlanned: false, history: [], workoutDate: "2026-09-24", isCardio: true })
    ).toEqual({ weight: 20, reps: 5 })
  })

  it("seeds weight and reps independently", () => {
    const sets = [set({ id: 1, weight: null, reps: 12 })]
    expect(
      seedSetForm({ sets, isPlanned: false, history, workoutDate: "2026-09-24", isCardio: false })
    ).toEqual({ weight: 90, reps: 12 })
  })
})

describe("setFormError", () => {
  it("uses mobile's messages", () => {
    expect(setFormError(100, 0, false)).toBe("Add at least 1 rep to log this set.")
    expect(setFormError(-1, 5, false)).toBe("Weight can’t be negative.")
    expect(setFormError(0, 5, false)).toBeNull()
    expect(setFormError(20, 0, true)).toBe("Set a level of at least 1.")
    expect(setFormError(-1, 5, true)).toBe("Time can’t be negative.")
    expect(setFormError(0, 5, true)).toBe("Set a time of at least 1 minute.")
    expect(setFormError(20, 5, true)).toBeNull()
  })
})

describe("rest editing", () => {
  const sets = [
    set({ id: 1, created_at: "2026-09-24T10:00:00.000Z" }),
    set({ id: 2, created_at: "2026-09-24T10:05:00.000Z", is_planned: true }),
    set({ id: 3, created_at: "2026-09-24T10:02:30.000Z" }),
  ]

  it("anchors on the newest logged set before this one", () => {
    expect(restAnchorForEdit(sets, 3, null)).toBe("2026-09-24T10:00:00.000Z")
  })

  it("falls back to the other exercise's last set for set 1", () => {
    expect(restAnchorForEdit(sets, 1, "2026-09-24T09:50:00.000Z")).toBe("2026-09-24T09:50:00.000Z")
    expect(restAnchorForEdit(sets, 1, null)).toBeNull()
  })

  it("computes seconds without a cap and never negative", () => {
    expect(restSecondsFrom("2026-09-24T10:00:00.000Z", "2026-09-24T10:02:30.000Z")).toBe(150)
    expect(restSecondsFrom("2026-09-24T10:00:00.000Z", "2026-09-24T12:00:00.000Z")).toBe(7200)
    expect(restSecondsFrom("2026-09-24T10:05:00.000Z", "2026-09-24T10:00:00.000Z")).toBe(0)
    expect(restSecondsFrom(null, "2026-09-24T10:00:00.000Z")).toBe(0)
    expect(restSecondsFrom("", "2026-09-24T10:00:00.000Z")).toBe(0)
  })

  it("rounds to whole seconds like mobile's startEdit", () => {
    expect(restSecondsFrom("2026-09-24T10:00:00.000Z", "2026-09-24T10:00:01.499Z")).toBe(1)
    expect(restSecondsFrom("2026-09-24T10:00:00.000Z", "2026-09-24T10:00:01.500Z")).toBe(2)
  })

  it("does not mask an unparseable timestamp (mobile's startEdit gives NaN too)", () => {
    expect(restSecondsFrom("not a date", "2026-09-24T10:00:00.000Z")).toBeNaN()
  })

  it("rebuilds created_at from the anchor", () => {
    expect(createdAtForRest("2026-09-24T10:00:00.000Z", 90)).toBe("2026-09-24T10:01:30.000Z")
  })
})

describe("nextSetPosition", () => {
  it("skips planned sets, null pairs and sets on their way out", () => {
    const sets = [
      set({ id: 1 }),
      set({ id: 2, is_planned: true }),
      set({ id: 3, weight: null }),
      set({ id: 4 }),
    ]
    expect(nextSetPosition(sets)).toBe(3)
    expect(nextSetPosition(sets, new Set([4]))).toBe(2)
    expect(nextSetPosition([])).toBe(1)
  })
})

describe("latestOtherSetIso", () => {
  it("takes the newest logged set of the other exercises", () => {
    const exercises = [
      { id: 1, sets: [set({ id: 1, created_at: "2026-09-24T10:00:00.000Z" })] },
      {
        id: 2,
        sets: [
          set({ id: 2, created_at: "2026-09-24T10:10:00.000Z" }),
          set({ id: 3, created_at: "2026-09-24T11:00:00.000Z", is_planned: true }),
        ],
      },
      { id: 3, sets: [set({ id: 4, created_at: "2026-09-24T12:00:00.000Z" })] },
    ]
    expect(latestOtherSetIso(exercises, 3)).toBe("2026-09-24T10:10:00.000Z")
    expect(latestOtherSetIso(exercises, null)).toBe("2026-09-24T12:00:00.000Z")
    expect(latestOtherSetIso([], null)).toBeNull()
  })
})

describe("setRestLabels", () => {
  it("skips planned rows and counts set 1 from the previous exercise", () => {
    const sets = [
      set({ id: 1, created_at: "2026-09-24T10:01:00.000Z" }),
      set({ id: 2, created_at: "2026-09-24T09:00:00.000Z", is_planned: true }),
      set({ id: 3, created_at: "2026-09-24T10:03:05.000Z" }),
    ]
    expect(setRestLabels(sets, "2026-09-24T10:00:00.000Z")).toEqual(["1m", null, "2m 5s"])
  })
})

describe("setPrBadge", () => {
  it("prefers overall over position and hides for planned", () => {
    expect(setPrBadge(set({ id: 1, is_pr: true, is_position_pr: true }), true)).toEqual({ kind: "overall", historical: false })
    expect(setPrBadge(set({ id: 1, was_pr: true }), true)).toEqual({ kind: "overall", historical: true })
    expect(setPrBadge(set({ id: 1, is_position_pr: true }), true)).toEqual({ kind: "position", historical: false })
    expect(setPrBadge(set({ id: 1, was_position_pr: true }), true)).toEqual({ kind: "position", historical: true })
    expect(setPrBadge(set({ id: 1, is_position_pr: true }), false)).toBeNull()
    expect(setPrBadge(set({ id: 1, is_pr: true, is_planned: true }), true)).toBeNull()
  })
})

describe("labels", () => {
  it("titles the planned-set popup", () => {
    expect(plannedSetTitle({ weight: 100, reps: 5 }, "kg", false)).toBe("100 kg × 5")
    expect(plannedSetTitle({ weight: 20, reps: 5 }, "kg", true)).toBe("20 min × Lvl 5")
    expect(plannedSetTitle({ weight: 20, reps: null }, "kg", true)).toBe("20 min × Lvl -")
  })

  it("titles the multi-delete confirm", () => {
    expect(deleteSetsTitle(1)).toBe("Delete 1 set?")
    expect(deleteSetsTitle(3)).toBe("Delete 3 sets?")
  })

  it("cleans numeric text", () => {
    expect(cleanNumericText("1a2.5", true)).toBe("12.5")
    expect(cleanNumericText("1.", true)).toBe("1.")
    expect(cleanNumericText("1.5", false)).toBe("15")
    expect(cleanNumericText("-3", false)).toBe("3")
  })
})

describe("Last time card", () => {
  const days = [
    day("2026-09-30", [hs({ id: 9, weight: 120, reps: 1 })]),
    day("2026-09-24", [hs({ id: 8, weight: 110, reps: 1 })]),
    day("2026-09-22", [hs({ id: 5, weight: null, reps: 5 })]),
    day("2026-09-20", [hs({ id: 1, weight: 100, reps: 5 }), hs({ id: 2, weight: 100, reps: 4 })]),
  ]

  it("finds the last session before the day, skipping days without a pair", () => {
    const last = lastSessionBefore(days, "2026-09-24")
    expect(last?.date).toBe("2026-09-20")
    expect(last?.sets.map((s) => s.id)).toEqual([1, 2])
    expect(lastSessionBefore(days, "2026-09-20")).toBeNull()
  })

  it("summarizes the collapsed line", () => {
    expect(lastSessionSummary([{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }], "kg")).toBe("100×5   100×4")
  })

  it("opens by default in position mode, before a set, or with no last session", () => {
    expect(lastTimeCardOpen({ manual: null, positionMode: true, hasSets: true, hasLast: true })).toBe(true)
    expect(lastTimeCardOpen({ manual: null, positionMode: false, hasSets: false, hasLast: true })).toBe(true)
    expect(lastTimeCardOpen({ manual: null, positionMode: false, hasSets: true, hasLast: false })).toBe(true)
    expect(lastTimeCardOpen({ manual: null, positionMode: false, hasSets: true, hasLast: true })).toBe(false)
    expect(lastTimeCardOpen({ manual: false, positionMode: true, hasSets: true, hasLast: true })).toBe(false)
  })

  it("counts history days through the workout date", () => {
    expect(historyDaysThrough(days, "2026-09-24")).toBe(3)
  })
})

describe("matchPendingAdds", () => {
  const ids = (...n: number[]) => n.map((id) => ({ id }))

  it("waits while no row has landed", () => {
    const pending = [{ key: 1, baseIds: new Set([10]) }]
    expect(matchPendingAdds(ids(10), pending)).toEqual({ landed: [], waiting: pending })
  })

  it("pairs rows with a fast double tap's placeholders in tap order", () => {
    // Both taps came before either write, so they share the same base.
    const a = { key: 1, baseIds: new Set([10]) }
    const b = { key: 2, baseIds: new Set([10]) }
    expect(matchPendingAdds(ids(10, 11), [a, b])).toEqual({ landed: [[11, a]], waiting: [b] })
    expect(matchPendingAdds(ids(10, 11, 12), [a, b])).toEqual({
      landed: [[11, a], [12, b]],
      waiting: [],
    })
  })

  it("keeps the first row on the first placeholder when the second tap saw it land", () => {
    const a = { key: 1, baseIds: new Set([10]) }
    const b = { key: 2, baseIds: new Set([10, 11]) }
    expect(matchPendingAdds(ids(10, 11), [a, b])).toEqual({ landed: [[11, a]], waiting: [b] })
  })

  it("finds the new row when a delete keeps the count the same", () => {
    const a = { key: 1, baseIds: new Set([10, 11]) }
    expect(matchPendingAdds(ids(10, 12), [a])).toEqual({ landed: [[12, a]], waiting: [] })
  })

  it("has nothing to do without placeholders", () => {
    expect(matchPendingAdds(ids(10), [])).toEqual({ landed: [], waiting: [] })
  })
})
