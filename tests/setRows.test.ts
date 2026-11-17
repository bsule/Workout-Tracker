// Set-row rules both clients share (@lift/core/setLogger): what an edit saves
// for an untouched weight, how a row shows cardio and time/distance sets, the
// position a "Set N PR" badge names, numeric field input, and the kind a new
// cardio exercise gets.

import { describe, it, expect, beforeEach } from "vitest"
import * as M from "@lift/core/store/mutations"
import { getExerciseHistoryQ } from "@lift/core/store/queries"
import { SEED_EXERCISES } from "@lift/core/store/seed"
import { toKg } from "@lift/core/units"
import {
  acceptNumericText,
  defaultKindForCategory,
  editedWeight,
  formatClock,
  lastSessionChipParts,
  lastSessionSummary,
  recordRepsText,
  setPositions,
  setValueText,
  weightFieldValue,
} from "@lift/core/setLogger"
import { currentSnapshot, loadSnapshot, resetStore } from "./helpers/store"

beforeEach(() => resetStore())

describe("editedWeight", () => {
  it("leaves an untouched lb field out of the patch, so 100 kg stays 100 kg", () => {
    const shown = weightFieldValue(100, "lb", false)
    expect(shown).toBe(220.5)
    // Converting the display value back is the drift this guards against.
    expect(toKg(shown, "lb")).not.toBe(100)
    expect(editedWeight(shown, 100, "lb", false)).toBeUndefined()
  })

  it("keeps a lb-typed weight exact for a kg user who leaves it alone", () => {
    const stored = toKg(135, "lb") // 61.23496995 kg, shown as 61.2
    expect(editedWeight(weightFieldValue(stored, "kg", false), stored, "kg", false)).toBeUndefined()
  })

  it("converts a changed field to kg", () => {
    expect(editedWeight(225, 100, "lb", false)).toBeCloseTo(toKg(225, "lb"), 10)
    expect(editedWeight(102.5, 100, "kg", false)).toBe(102.5)
  })

  it("passes cardio minutes through unconverted", () => {
    expect(weightFieldValue(20, "lb", true)).toBe(20)
    expect(editedWeight(20, 20, "lb", true)).toBeUndefined()
    expect(editedWeight(25, 20, "lb", true)).toBe(25)
  })

  it("keeps a stored null when the field still shows 0", () => {
    expect(editedWeight(0, null, "lb", false)).toBeUndefined()
    expect(editedWeight(5, null, "kg", false)).toBe(5)
  })

  it("an untouched edit changes neither the stored weight nor the PR stars", () => {
    M.updateSettings({ weight_unit: "lb" })
    const w = M.createWorkout("2026-01-01").row
    const ex = M.createExercise({ name: "Bench", category: "chest" })
    const we = M.addExerciseToWorkout(w.id, ex.id)
    const a = M.addSet(we.id, { weight: 100, reps: 5 })
    const b = M.addSet(we.id, { weight: 100, reps: 5 })
    const before = currentSnapshot().sets.map((s) => ({ ...s }))
    const edited = editedWeight(weightFieldValue(b.weight, "lb", false), b.weight, "lb", false)
    M.updateSet(b.id, { ...(edited === undefined ? {} : { weight: edited }), reps: 5 })
    const after = currentSnapshot().sets
    expect(after.find((s) => s.id === b.id)?.weight).toBe(100)
    expect(after).toEqual(before)
    // The earlier tie still holds the record.
    expect(after.find((s) => s.id === a.id)?.is_pr).toBe(true)
    expect(after.find((s) => s.id === b.id)?.is_pr).toBe(false)
  })
})

describe("setValueText", () => {
  it("shows cardio as a clock and a level, unconverted", () => {
    expect(setValueText({ weight: 20, reps: 5 }, "lb", true)).toEqual({
      amount: "20:00",
      unit: "",
      reps: "Lvl 5",
    })
    expect(setValueText({ weight: null, reps: null }, "lb", true)).toEqual({
      amount: "-",
      unit: "",
      reps: "-",
    })
  })

  it("shows a weight in the display unit", () => {
    expect(setValueText({ weight: 100, reps: 5 }, "lb", false)).toEqual({
      amount: "220.5",
      unit: "lb",
      reps: "5",
    })
    expect(setValueText({ weight: null, reps: 12 }, "kg", false)).toEqual({
      amount: "-",
      unit: "kg",
      reps: "12",
    })
  })

  it("shows distance and time when there is no weight", () => {
    expect(
      setValueText(
        { weight: null, reps: null, distance_m: 5000, distance_unit_display: "km", time_seconds: 1500 },
        "lb",
        true
      )
    ).toEqual({ amount: "5", unit: "km", reps: "25:00" })
    expect(
      setValueText(
        { weight: null, reps: null, distance_m: 1609.344, distance_unit_display: "mi", time_seconds: null },
        "lb",
        false
      )
    ).toEqual({ amount: "1", unit: "mi", reps: "" })
    expect(
      setValueText({ weight: null, reps: null, distance_m: 400, distance_unit_display: "", time_seconds: null }, "kg", false)
    ).toEqual({ amount: "400", unit: "m", reps: "" })
    expect(setValueText({ weight: null, reps: null, time_seconds: 75 }, "lb", false)).toEqual({
      amount: "1:15",
      unit: "",
      reps: "",
    })
  })

  it("formats times past an hour", () => {
    expect(formatClock(3723)).toBe("1:02:03")
    expect(formatClock(59.6)).toBe("1:00")
  })

  it("record rows and Last time chips follow the same rule", () => {
    expect(recordRepsText(1, false)).toBe("× 1 rep")
    expect(recordRepsText(8, false)).toBe("× 8 reps")
    expect(recordRepsText(5, true)).toBe("× Lvl 5")
    expect(lastSessionChipParts({ weight: 20, reps: 5 }, "lb", true)).toEqual({
      amount: "20:00",
      reps: "Lvl 5",
    })
    expect(lastSessionSummary([{ weight: 20, reps: 5 }], "lb", true)).toBe("20:00×Lvl 5")
    expect(lastSessionSummary([{ weight: 100, reps: 5 }], "kg")).toBe("100×5")
  })
})

describe("setPositions", () => {
  it("counts only logged weight x reps sets, like prs.ts", () => {
    const rows = [
      { weight: 100, reps: 5, is_planned: true },
      { weight: 100, reps: 5 },
      { weight: null, reps: null },
      { weight: 110, reps: 3 },
    ]
    expect(setPositions(rows)).toEqual([0, 1, 0, 2])
  })

  it("keeps the position a history row carries", () => {
    expect(setPositions([{ weight: 1, reps: 1, position: 2 }, { weight: 1, reps: 1, position: 1 }])).toEqual([2, 1])
  })

  it("matches the position-PR star on a queued target and a second run on one date", () => {
    const w = M.createWorkout("2026-01-01").row
    const ex = M.createExercise({ name: "Row", category: "back" })
    const we1 = M.addExerciseToWorkout(w.id, ex.id)
    M.addSet(we1.id, { weight: 50, reps: 10 })
    M.addSet(we1.id, { weight: 60, reps: 10 })
    // A second run of the same exercise that day (an import can make one).
    const snap = currentSnapshot()
    const we2 = { ...we1, id: 9000, order: 1, note: "" }
    loadSnapshot({ ...snap, workout_exercises: [...snap.workout_exercises, we2] })
    M.addSet(we2.id, { weight: 100, reps: 5, is_planned: true })
    const best = M.addSet(we2.id, { weight: 200, reps: 10 })

    const weSets = currentSnapshot()
      .sets.filter((s) => s.workout_exercise_id === we2.id)
      .sort((a, b) => a.order - b.order)
    // Row 2 in the list, but the first logged set of its run.
    expect(weSets.map((s) => s.id)).toEqual([expect.any(Number), best.id])
    expect(setPositions(weSets)).toEqual([0, 1])
    expect(weSets[1].is_position_pr || weSets[1].is_pr).toBe(true)

    // The merged history day lists both runs; each keeps its own numbering.
    const day = getExerciseHistoryQ(ex.id)[0]
    expect(day.sets).toHaveLength(3)
    expect(setPositions(day.sets)).toEqual([1, 2, 1])
  })
})

describe("acceptNumericText", () => {
  it("refuses a second decimal point instead of saving a stale value", () => {
    expect(acceptNumericText("1.2.3", true)).toBeNull()
    expect(acceptNumericText("1.2", true)).toEqual({ text: "1.2", value: 1.2 })
  })

  it("keeps in-between text and saves what it reads as", () => {
    expect(acceptNumericText("1.", true)).toEqual({ text: "1.", value: 1 })
    expect(acceptNumericText(".", true)).toEqual({ text: ".", value: 0 })
    expect(acceptNumericText("", true)).toEqual({ text: "", value: 0 })
    expect(acceptNumericText("12a", false)).toEqual({ text: "12", value: 12 })
    expect(acceptNumericText("1.5", false)).toEqual({ text: "15", value: 15 })
  })
})

describe("defaultKindForCategory", () => {
  it("gives cardio the kind the built-in cardio exercises have", () => {
    for (const e of SEED_EXERCISES) {
      expect(defaultKindForCategory(e.category)).toBe(e.kind)
    }
    expect(defaultKindForCategory("cardio")).toBe("distance_time")
    expect(defaultKindForCategory("my-custom-category")).toBe("weight_reps")
  })

  it("createExercise uses it, so a new cardio exercise takes no PR stars", () => {
    const ex = M.createExercise({ name: "Rower", category: "cardio" })
    expect(ex.kind).toBe("distance_time")
    expect(M.createExercise({ name: "Sled", category: "cardio", kind: "weight_reps" }).kind).toBe(
      "weight_reps"
    )
    const w = M.createWorkout("2026-01-01").row
    const we = M.addExerciseToWorkout(w.id, ex.id)
    // Cardio stores minutes in weight and a level in reps.
    M.addSet(we.id, { weight: 20, reps: 5 })
    M.addSet(we.id, { weight: 30, reps: 6 })
    for (const s of currentSnapshot().sets) {
      expect([s.is_pr, s.was_pr, s.is_position_pr, s.was_position_pr]).toEqual([
        false,
        false,
        false,
        false,
      ])
    }
  })
})
