import { beforeEach, describe, expect, it } from "vitest"
import { importSnapshotJson } from "@lift/core/import"
import { configure, hydrate, setStorageFactory } from "@lift/core/store/persist"
import { serialize } from "@lift/core/store/blob"
import { emptySnapshot } from "@lift/core/store/schema"
import * as M from "@lift/core/store/mutations"
import { getWorkoutByDateQ } from "@lift/core/store/queries"
import { gymAddError } from "@lift/core/workouts"
import {
  currentSnapshot,
  installMemoryStorage,
  loadSnapshot,
  memoryStorage,
  resetStore,
  type MemoryStorage,
} from "./helpers/store"

// Two data bugs, fixed together:
// 1. A merge import matched workouts on date + gym, so a file workout on a
//    date the device already had (under another gym) became a second workout
//    that day. Every other path (createWorkout, the FitNotes importer, the
//    date index) assumes one workout per date.
// 2. Gym names that differ only in case ("Golds" / "golds") could both be
//    saved, and a rename missed workouts stored under the other spelling.

type FileSet = { weight_kg: number; reps: number; order?: number }
type FileWorkout = {
  date: string
  gym?: string
  notes?: string
  exercises: { exercise: { name: string; category: string; kind?: string }; sets: FileSet[] }[]
}

function file(workouts: FileWorkout[], saved_gyms: string[] = []): string {
  return JSON.stringify({ version: 2, saved_gyms, workouts, day_notes: [] })
}

function bench(sets: FileSet[]) {
  return { exercise: { name: "Bench Press", category: "chest", kind: "weight_reps" }, sets }
}
function squat(sets: FileSet[]) {
  return { exercise: { name: "Back Squat", category: "legs", kind: "weight_reps" }, sets }
}

const workoutsOn = (date: string) => currentSnapshot().workouts.filter((w) => w.date === date)
const setsOfWorkout = (workoutId: number) => {
  const snap = currentSnapshot()
  const weIds = new Set(
    snap.workout_exercises.filter((we) => we.workout_id === workoutId).map((we) => we.id)
  )
  return snap.sets
    .filter((s) => weIds.has(s.workout_exercise_id))
    .sort((a, b) => a.workout_exercise_id - b.workout_exercise_id || a.order - b.order)
}

describe("JSON import: one workout per date", () => {
  beforeEach(() => {
    resetStore()
    installMemoryStorage()
  })

  it("merges a file workout into the device's workout on that date, whatever its gym", async () => {
    const local = M.createWorkout("2026-05-01").row
    M.patchWorkout(local.id, { gym: "" })
    const ex = M.createExercise({ name: "Deadlift", category: "back" })
    M.addSet(M.addExerciseToWorkout(local.id, ex.id).id, { weight: 140, reps: 3 })

    await importSnapshotJson(
      file([{ date: "2026-05-01", gym: "Golds", exercises: [bench([{ weight_kg: 80, reps: 5, order: 0 }])] }]),
      { mode: "merge" }
    )

    const day = workoutsOn("2026-05-01")
    expect(day).toHaveLength(1)
    expect(day[0].id).toBe(local.id)
    expect(setsOfWorkout(local.id).map((s) => s.weight)).toEqual([140, 80])
    // The screens and createWorkout land on that same workout.
    expect(getWorkoutByDateQ("2026-05-01")?.id).toBe(local.id)
    expect(M.createWorkout("2026-05-01").row.id).toBe(local.id)
  })

  it("folds two same-date workouts from one file into one, keeping every set", async () => {
    await importSnapshotJson(
      file([
        {
          date: "2026-05-02",
          gym: "Golds",
          notes: "morning",
          exercises: [bench([{ weight_kg: 80, reps: 5, order: 0 }, { weight_kg: 80, reps: 5, order: 1 }])],
        },
        {
          date: "2026-05-02",
          gym: "Home",
          notes: "evening",
          exercises: [
            bench([{ weight_kg: 60, reps: 10, order: 0 }, { weight_kg: 60, reps: 10, order: 1 }]),
            squat([{ weight_kg: 100, reps: 5, order: 0 }]),
          ],
        },
      ]),
      { mode: "replace" }
    )

    const day = workoutsOn("2026-05-02")
    expect(day).toHaveLength(1)
    expect(day[0].gym).toBe("Golds")
    expect(day[0].notes).toBe("morning\n\nevening")
    // Read it the way the screens do ("Bench Press" is a built-in, so it is
    // not a row in snapshot.exercises).
    const view = getWorkoutByDateQ("2026-05-02")!
    expect(view.exercises.map((e) => e.exercise.name).sort()).toEqual(["Back Squat", "Bench Press"])
    const benchSets = view.exercises
      .find((e) => e.exercise.name === "Bench Press")!
      .sets.slice()
      .sort((a, b) => a.order - b.order)
    // The second session's sets come after the first's, not dropped as repeats.
    expect(benchSets.map((s) => [s.weight, s.order])).toEqual([
      [80, 0],
      [80, 1],
      [60, 2],
      [60, 3],
    ])
  })

  it("stays a no-op when the same file is imported again in merge mode", async () => {
    const json = file([
      { date: "2026-05-03", gym: "Golds", exercises: [bench([{ weight_kg: 80, reps: 5, order: 0 }])] },
      { date: "2026-05-03", gym: "Home", exercises: [bench([{ weight_kg: 60, reps: 8, order: 0 }])] },
    ])
    await importSnapshotJson(json, { mode: "merge" })
    const before = currentSnapshot().sets.length
    await importSnapshotJson(json, { mode: "merge" })
    expect(currentSnapshot().sets.length).toBe(before)
    expect(workoutsOn("2026-05-03")).toHaveLength(1)
  })

  it("keeps one workout per date for distinct dates as before", async () => {
    await importSnapshotJson(
      file([
        { date: "2026-05-04", exercises: [bench([{ weight_kg: 80, reps: 5 }])] },
        { date: "2026-05-05", exercises: [bench([{ weight_kg: 82.5, reps: 5 }])] },
      ]),
      { mode: "replace" }
    )
    expect(workoutsOn("2026-05-04")).toHaveLength(1)
    expect(workoutsOn("2026-05-05")).toHaveLength(1)
  })
})

describe("gym names that differ only in case", () => {
  let storage: MemoryStorage

  beforeEach(async () => {
    resetStore()
    storage = memoryStorage()
    setStorageFactory(() => storage)
    configure(`accounts/gym-case-${Math.random()}`)
    await hydrate()
    storage.pending.length = 0
  })

  const gymNames = () => currentSnapshot().gyms.map((g) => g.name)
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it("createGym returns the saved gym instead of adding a case variant, and logs nothing", async () => {
    const golds = M.createGym("Golds")
    await tick()
    storage.pending.length = 0
    const again = M.createGym("  golds ")
    await tick()
    expect(again.id).toBe(golds.id)
    expect(again.name).toBe("Golds")
    expect(gymNames()).toEqual(["Golds"])
    // A logged create_gym for a row that was never added would add it on replay.
    expect(storage.pending).toEqual([])
  })

  it("gymAddError refuses a name that matches a saved gym ignoring case", () => {
    const gyms = [{ id: 1, name: "Golds" }]
    expect(gymAddError(gyms, "GOLDS")).toBe("A gym with that name already exists.")
    expect(gymAddError(gyms, "   ")).toBe("Name can't be empty.")
    expect(gymAddError(gyms, "Home")).toBeNull()
  })

  it("patchWorkout stores the saved gym's spelling and adds no variant", () => {
    M.createGym("Golds")
    const w = M.createWorkout("2026-06-01").row
    M.patchWorkout(w.id, { gym: "golds" })
    expect(currentSnapshot().workouts.find((x) => x.id === w.id)?.gym).toBe("Golds")
    expect(gymNames()).toEqual(["Golds"])
  })

  it("renameGym refuses another gym's name in any case, but allows changing its own case", () => {
    const golds = M.createGym("Golds")
    M.createGym("Home")
    expect(M.renameGym(golds.id, "home")).toBeNull()
    expect(gymNames()).toEqual(["Golds", "Home"])
    expect(M.renameGym(golds.id, "GOLDS")?.name).toBe("GOLDS")
    expect(gymNames()).toEqual(["GOLDS", "Home"])
  })

  it("renameGym carries workouts stored under another spelling of the same gym", () => {
    const golds = M.createGym("Golds")
    const a = M.createWorkout("2026-06-02").row
    const b = M.createWorkout("2026-06-03").row
    M.patchWorkout(a.id, { gym: "Golds" })
    // An older build could store a different spelling on the workout.
    const snap = currentSnapshot()
    loadSnapshot({
      ...snap,
      workouts: snap.workouts.map((w) => (w.id === b.id ? { ...w, gym: "golds" } : w)),
    })

    M.renameGym(golds.id, "Gold's Gym")
    const gymOf = (id: number) => currentSnapshot().workouts.find((w) => w.id === id)?.gym
    expect(gymOf(a.id)).toBe("Gold's Gym")
    expect(gymOf(b.id)).toBe("Gold's Gym")
  })

  it("renameGym leaves workouts of a separately saved case variant alone", () => {
    const w = M.createWorkout("2026-06-04").row
    const snap = currentSnapshot()
    // A pair an older build could save, and a workout at the lowercase one.
    loadSnapshot({
      ...snap,
      gyms: [
        { id: 901, name: "Golds" },
        { id: 902, name: "golds" },
      ],
      workouts: snap.workouts.map((x) => (x.id === w.id ? { ...x, gym: "golds" } : x)),
    })
    M.renameGym(901, "Downtown")
    expect(currentSnapshot().workouts.find((x) => x.id === w.id)?.gym).toBe("golds")
  })
})

describe("crash-log replay of gym renames", () => {
  it("replays a rename_gym op, workouts included", async () => {
    resetStore()
    const storage = memoryStorage()
    setStorageFactory(() => storage)
    configure(`accounts/rename-replay-${Math.random()}`)
    const base = emptySnapshot("seed-device")
    base.gyms = [{ id: 700, name: "Golds" }]
    base.workouts = [
      {
        id: 701,
        date: "2026-06-05",
        status: "done",
        started_at: null,
        finished_at: null,
        gym: "Golds",
        notes: "",
        created_at: "2026-06-05T08:00:00.000Z",
      },
    ]
    await storage.writeSnapshot(await serialize(base))
    await storage.appendPending(
      JSON.stringify({ op: "rename_gym", id: 700, oldName: "Golds", newName: "Gold's Gym" })
    )

    await hydrate()

    expect(currentSnapshot().gyms).toEqual([{ id: 700, name: "Gold's Gym" }])
    expect(currentSnapshot().workouts[0].gym).toBe("Gold's Gym")
  })
})

describe("JSON import: gym spelling", () => {
  beforeEach(() => {
    resetStore()
    installMemoryStorage()
  })

  it("stores the saved gym's spelling on imported workouts", async () => {
    M.createGym("Golds")
    await importSnapshotJson(
      file([{ date: "2026-07-01", gym: "GOLDS", exercises: [bench([{ weight_kg: 80, reps: 5 }])] }]),
      { mode: "merge" }
    )
    expect(workoutsOn("2026-07-01")[0].gym).toBe("Golds")
  })

  it("uses the file's saved spelling when the gym is new to the device", async () => {
    await importSnapshotJson(
      file(
        [{ date: "2026-07-02", gym: "home gym", exercises: [bench([{ weight_kg: 80, reps: 5 }])] }],
        ["Home Gym"]
      ),
      { mode: "replace" }
    )
    expect(workoutsOn("2026-07-02")[0].gym).toBe("Home Gym")
    expect(currentSnapshot().gyms.map((g) => g.name)).toEqual(["Home Gym"])
  })
})
