import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addDays, buildMonthGrid, enumerateDates, todayString } from "@lift/core/dates"
import {
  agoLabel,
  elapsedS,
  formatDuration,
  formatElapsed,
  formatRelative,
  formatRest,
  labelForDate,
  niceDate,
  noteActionLabel,
  recordDate,
  shortDate,
} from "@lift/core/format"
import { readSettings } from "@lift/core/settings"
import {
  gymRenameError,
  isEmptyWorkoutShell,
  lastWorkoutTopSet,
  matchGymName,
} from "@lift/core/workouts"
import type { ExerciseHistoryDay, HistorySet } from "@lift/core"

// These helpers were lifted verbatim from the mobile screens so the web app
// shares them. The expectations pin mobile's behavior, which is the reference.

beforeEach(() => {
  vi.useFakeTimers()
  // Wed Sep 24 2026, local noon.
  vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("readSettings", () => {
  it("uses mobile's defaults when keys are missing", () => {
    expect(readSettings({ weight_unit: "kg", first_day_of_week: 0 })).toEqual({
      weightUnit: "kg",
      firstDayOfWeek: 0,
      showOneRm: false,
      showPositionPrs: true,
      showRestTime: true,
      showTimeSinceLastSet: true,
      showLastTime: true,
      restTimerEnabled: true,
      restTimerCutoffS: 360,
    })
  })

  it("keeps explicit values", () => {
    const s = readSettings({
      weight_unit: "lb",
      first_day_of_week: 1,
      show_one_rm: true,
      show_position_prs: false,
      show_rest_time: false,
      show_time_since_last_set: false,
      show_last_time: false,
    })
    expect(s.showOneRm).toBe(true)
    expect(s.showPositionPrs).toBe(false)
    expect(s.showRestTime).toBe(false)
    expect(s.showTimeSinceLastSet).toBe(false)
    expect(s.showLastTime).toBe(false)
  })
})

describe("dates", () => {
  it("builds dates in local time", () => {
    expect(todayString()).toBe("2026-09-24")
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(enumerateDates("2026-09-29", "2026-10-02")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ])
    expect(enumerateDates("2026-10-02", "2026-10-01")).toEqual([])
  })

  it("lays out a month grid for both week starts", () => {
    // Sep 1 2026 is a Tuesday.
    const sun = buildMonthGrid(2026, 9, 0)
    expect(sun.slice(0, 3).map((c) => c.day)).toEqual([null, null, 1])
    expect(sun.length % 7).toBe(0)
    const mon = buildMonthGrid(2026, 9, 1)
    expect(mon.slice(0, 2).map((c) => c.date)).toEqual([null, "2026-09-01"])
    expect(mon.filter((c) => c.day != null)).toHaveLength(30)
  })
})

describe("labels", () => {
  it("names nearby days and spells out the rest", () => {
    expect(labelForDate("2026-09-24")).toBe("Today")
    expect(labelForDate("2026-09-23")).toBe("Yesterday")
    expect(labelForDate("2026-09-25")).toBe("Tomorrow")
    expect(labelForDate("2026-09-21")).toBe("Monday, September 21")
  })

  it("words the day-note menu item", () => {
    expect(noteActionLabel("2026-09-24", false)).toBe("Add a note for today")
    expect(noteActionLabel("2026-09-23", true)).toBe("Edit yesterday's note")
    expect(noteActionLabel("2026-09-25", false)).toBe("Add a note for tomorrow")
    expect(noteActionLabel("2026-09-01", true)).toBe("Edit this day's note")
  })

  it("formats short dates, with the year only on records from another year", () => {
    expect(niceDate("2026-09-22")).toBe("Tue, Sep 22")
    expect(shortDate("2026-09-22")).toBe("Sep 22")
    expect(recordDate("2026-09-22")).toBe("Sep 22")
    expect(recordDate("2024-09-22")).toBe("Sep 22, 2024")
  })

  it("counts calendar days for ago labels", () => {
    expect(agoLabel("2026-09-25")).toBe("Today")
    expect(agoLabel("2026-09-23")).toBe("Yesterday")
    expect(agoLabel("2026-09-18")).toBe("6 days ago")
    expect(agoLabel("2026-09-17")).toBe("1 week ago")
    expect(agoLabel("2026-09-03")).toBe("3 weeks ago")
    expect(agoLabel("2026-08-20")).toBe("1 month ago")
    expect(agoLabel("2025-09-01")).toBe("1 year ago")
    expect(formatRelative("2026-09-20")).toBe("4d ago")
    expect(formatRelative("2026-09-10")).toBe("2w ago")
    expect(formatRelative("2026-06-01")).toBe("3mo ago")
  })

  it("formats durations and rests", () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(300)).toBe("5m")
    expect(formatDuration(3900)).toBe("1h 5m")
    const t = "2026-09-24T12:00:00.000Z"
    const at = (s: number) => new Date(Date.parse(t) + s * 1000).toISOString()
    expect(formatRest(null, t)).toBeNull()
    expect(formatRest(t, at(30))).toBeNull()
    expect(formatRest(t, at(45))).toBe("45s")
    expect(formatRest(t, at(120))).toBe("2m")
    expect(formatRest(t, at(125))).toBe("2m 5s")
    expect(formatRest(t, at(1801))).toBeNull()
  })

  it("formats the since-last-set count", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(59)).toBe("59s")
    expect(formatElapsed(125)).toBe("2m 5s")
    expect(elapsedS(Date.now() + 5000)).toBe(0)
    expect(elapsedS(Date.now() - 2500)).toBe(2)
  })
})

describe("workout rules", () => {
  const shell = { started_at: null, gym: "", notes: "", status: undefined }

  it("treats only a workout with nothing in it as an empty shell", () => {
    expect(isEmptyWorkoutShell(shell)).toBe(true)
    expect(isEmptyWorkoutShell({ ...shell, notes: "felt good" })).toBe(false)
    expect(isEmptyWorkoutShell({ ...shell, gym: "Home" })).toBe(false)
    expect(isEmptyWorkoutShell({ ...shell, started_at: "2026-09-24T10:00:00Z" })).toBe(false)
    expect(isEmptyWorkoutShell({ ...shell, status: "planned" as const })).toBe(false)
  })

  function day(date: string, sets: [number | null, number | null][]): ExerciseHistoryDay {
    return {
      date,
      note: "",
      sets: sets.map(
        ([weight, reps], i) =>
          ({ id: i, weight, reps, distance_m: null, time_seconds: null }) as HistorySet
      ),
    }
  }

  it("prefills from the newest other day that has a weight x reps set", () => {
    const history = [
      day("2026-09-24", [[100, 5]]),
      day("2026-09-20", [[null, null]]),
      day("2026-09-18", [
        [60, 10],
        [80, 6],
        [70, 8],
      ]),
    ]
    expect(lastWorkoutTopSet(history, "2026-09-24")).toEqual({ weight: 80, reps: 6 })
    // Only the current date is skipped: a later session seeds a back-dated log.
    expect(lastWorkoutTopSet(history, "2026-09-10")).toEqual({ weight: 100, reps: 5 })
    expect(lastWorkoutTopSet([], null)).toBeNull()
  })

  it("matches saved gyms ignoring case", () => {
    expect(matchGymName(["Golds", "Home"], " golds ")).toBe("Golds")
    expect(matchGymName(["Golds"], "Planet")).toBeUndefined()
  })

  it("validates a gym rename", () => {
    const gyms = [
      { id: 1, name: "Golds" },
      { id: 2, name: "Home" },
    ]
    expect(gymRenameError(gyms, 1, "  ")).toBe("Name can't be empty.")
    expect(gymRenameError(gyms, 1, "Golds ")).toBe("unchanged")
    expect(gymRenameError(gyms, 9, "Anything")).toBe("unchanged")
    expect(gymRenameError(gyms, 1, "home")).toBe("A gym with that name already exists.")
    expect(gymRenameError(gyms, 1, "Golds Gym")).toBeNull()
  })
})
