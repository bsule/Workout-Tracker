import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  previewFitnotesCsv,
  importFitnotesCsv,
  FITNOTES_HEADERS,
} from "@lift/core/import"
import { installMemoryStorage, currentSnapshot, loadSnapshot, resetStore } from "./helpers/store"
import { blankSnapshot, exercise } from "./helpers/build"
import { SEED_EXERCISES } from "@lift/core/store/seed"

const HEADER = FITNOTES_HEADERS.join(",")

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n"
}

const FIXTURE = fileURLToPath(
  new URL("./fixtures/fitnotes-sample.csv", import.meta.url)
)

beforeEach(() => {
  installMemoryStorage()
  resetStore()
})

describe("previewFitnotesCsv", () => {
  it("recognizes the FitNotes header layout", () => {
    const p = previewFitnotesCsv(csv(["2026-01-01,Bench Press,Chest,100,,5,,,,,wr"]))
    expect(p.format).toBe("fitnotes")
    expect(p.rowCount).toBe(1)
  })

  it("flags an unrelated CSV as unknown", () => {
    const p = previewFitnotesCsv("foo,bar\n1,2\n")
    expect(p.format).toBe("unknown")
  })

  it("previews the sample fixture as fitnotes", () => {
    const text = readFileSync(FIXTURE, "utf8")
    const p = previewFitnotesCsv(text)
    expect(p.format).toBe("fitnotes")
    expect(p.rowCount).toBeGreaterThan(0)
  })
})

describe("importFitnotesCsv: parsing & conversions", () => {
  it("imports a basic weight/reps row", async () => {
    const result = await importFitnotesCsv(
      csv(["2026-01-01,Bench Press,Chest,100,,5,,,,,wr"])
    )
    expect(result.imported).toBe(1)
    const snap = currentSnapshot()
    expect(snap.sets).toHaveLength(1)
    expect(snap.sets[0].weight).toBe(100)
    expect(snap.sets[0].reps).toBe(5)
  })

  it("converts pounds to kg when the kg column is empty", async () => {
    await importFitnotesCsv(csv(["2026-01-01,Bench Press,Chest,,225,5,,,,,wr"]))
    const s = currentSnapshot().sets[0]
    expect(s.weight).toBeCloseTo(225 * 0.45359237, 4)
  })

  it("converts a distance/time cardio row to meters and seconds", async () => {
    await importFitnotesCsv(
      csv(["2026-01-02,Treadmill,Cardio,,,,5,km,00:30:00,easy,dt"])
    )
    const s = currentSnapshot().sets[0]
    expect(s.distance_m).toBeCloseTo(5000, 3)
    expect(s.distance_unit_display).toBe("km")
    expect(s.time_seconds).toBe(1800)
    expect(s.note).toBe("easy")
  })

  it("creates exercises that don't exist yet and reports them", async () => {
    const result = await importFitnotesCsv(
      csv(["2026-01-01,Frobnicator Press,Chest,50,,8,,,,,wr"])
    )
    expect(result.exercisesCreated).toContain("Frobnicator Press")
    expect(
      currentSnapshot().exercises.some((e) => e.name === "Frobnicator Press")
    ).toBe(true)
  })
})

describe("importFitnotesCsv: built-in exercises", () => {
  const benchId = SEED_EXERCISES.find((e) => e.name === "Bench Press")!.id

  for (const mode of ["merge", "replace"] as const) {
    it(`logs a built-in name under the built-in exercise (${mode})`, async () => {
      const result = await importFitnotesCsv(
        csv(["2026-01-01,bench press,Chest,100,,5,,,,,wr"]),
        { mode }
      )
      expect(result.exercisesCreated).toEqual([])
      const snap = currentSnapshot()
      expect(snap.exercises).toEqual([])
      expect(snap.workout_exercises[0].exercise_id).toBe(benchId)
    })
  }
})

describe("importFitnotesCsv: kind and deleted exercises", () => {
  const seedId = (name: string) => SEED_EXERCISES.find((e) => e.name === name)!.id
  const exerciseOfRow = (i: number) => {
    const snap = currentSnapshot()
    const we = snap.workout_exercises.find((w) => w.id === snap.sets[i].workout_exercise_id)!
    return (
      snap.exercises.find((e) => e.id === we.exercise_id) ??
      SEED_EXERCISES.find((e) => e.id === we.exercise_id)!
    )
  }

  it("a time-only Plank gets its own time-only exercise, not the weight × reps built-in", async () => {
    const result = await importFitnotesCsv(
      csv([
        "2026-01-01,Plank,Abs,,,,,,0:01:30,,t",
        "2026-01-02,Plank,Abs,,,,,,0:02:00,,t",
        "2026-01-03,Plank,Abs,20,,10,,,,,wr",
      ]),
      { mode: "replace" }
    )
    expect(result.exercisesCreated).toEqual(["Plank"])
    const timed = exerciseOfRow(0)
    expect(timed.kind).toBe("time_only")
    expect(timed.id).not.toBe(seedId("Plank"))
    // The second timed row reuses the custom row; the weighted one keeps the built-in.
    expect(exerciseOfRow(1).id).toBe(timed.id)
    expect(exerciseOfRow(2).id).toBe(seedId("Plank"))
  })

  it("a bodyweight Push-Up gets a bodyweight exercise", async () => {
    await importFitnotesCsv(csv(["2026-01-01,Push-Up,Chest,,,20,,,,,br"]), { mode: "replace" })
    expect(exerciseOfRow(0).kind).toBe("bodyweight_reps")
    expect(exerciseOfRow(0).id).not.toBe(seedId("Push-Up"))
  })

  it("a row with no Kind still matches the built-in", async () => {
    await importFitnotesCsv(csv(["2026-01-01,Plank,Abs,20,,10,,,,,"]), { mode: "replace" })
    expect(exerciseOfRow(0).id).toBe(seedId("Plank"))
  })

  it("does not attach sets to a deleted built-in", async () => {
    const benchId = seedId("Bench Press")
    loadSnapshot({
      ...blankSnapshot(),
      exercises: [{ id: benchId, name: "Bench Press", category: "chest", kind: "weight_reps", is_custom: false, is_deleted: true }],
    })
    const result = await importFitnotesCsv(csv(["2026-01-01,Bench Press,Chest,100,,5,,,,,wr"]), { mode: "merge" })
    expect(result.exercisesCreated).toEqual(["Bench Press"])
    const ex = exerciseOfRow(0)
    expect(ex.id).not.toBe(benchId)
    expect(ex.is_deleted).toBeFalsy()
  })

  it("does not attach sets to a deleted custom exercise", async () => {
    loadSnapshot({
      ...blankSnapshot(),
      exercises: [{ ...exercise(900, "Spoto Press", "chest"), is_deleted: true }],
    })
    await importFitnotesCsv(csv(["2026-01-01,Spoto Press,Chest,80,,5,,,,,wr"]), { mode: "merge" })
    expect(exerciseOfRow(0).id).not.toBe(900)
  })

  it("matches names across spacing and Unicode forms", async () => {
    const nfd = "Cafe\u0301 Curl"
    await importFitnotesCsv(
      csv([
        "2026-01-01,Bench   Press,Chest,100,,5,,,,,wr",
        `2026-01-02,${nfd.normalize("NFC")},Arms,20,,10,,,,,wr`,
        `2026-01-03,${nfd.normalize("NFD")},Arms,20,,10,,,,,wr`,
      ]),
      { mode: "replace" }
    )
    expect(exerciseOfRow(0).id).toBe(seedId("Bench Press"))
    expect(exerciseOfRow(1).id).toBe(exerciseOfRow(2).id)
    expect(currentSnapshot().exercises).toHaveLength(1)
  })
})

describe("importFitnotesCsv: error rows", () => {
  it("records and skips malformed rows but imports the good ones", async () => {
    const result = await importFitnotesCsv(
      csv([
        "2026-01-01,Bench Press,Chest,100,,5,,,,,wr", // ok
        "not-a-date,Bench Press,Chest,100,,5,,,,,wr", // bad date
        ",Bench Press,Chest,100,,5,,,,,wr", // missing date
        "2026-01-01,Bench Press,Chest,100,,9999,,,,,wr", // reps over max
      ])
    )
    expect(result.imported).toBe(1)
    expect(result.errors.length).toBe(3)
  })

  it("skips future-dated rows", async () => {
    const result = await importFitnotesCsv(
      csv(["2099-01-01,Bench Press,Chest,100,,5,,,,,wr"])
    )
    expect(result.imported).toBe(0)
    expect(result.errors[0].message).toMatch(/Future date/)
  })
})

describe("importFitnotesCsv: modes", () => {
  it("merge mode keeps existing data", async () => {
    await importFitnotesCsv(csv(["2026-01-01,Bench Press,Chest,100,,5,,,,,wr"]), {
      mode: "merge",
    })
    await importFitnotesCsv(csv(["2026-01-02,Squat,Legs,140,,3,,,,,wr"]), {
      mode: "merge",
    })
    expect(currentSnapshot().sets).toHaveLength(2)
  })

  it("replace mode wipes prior workout data first", async () => {
    await importFitnotesCsv(csv(["2026-01-01,Bench Press,Chest,100,,5,,,,,wr"]), {
      mode: "merge",
    })
    await importFitnotesCsv(csv(["2026-02-01,Squat,Legs,140,,3,,,,,wr"]), {
      mode: "replace",
    })
    const snap = currentSnapshot()
    expect(snap.sets).toHaveLength(1)
    expect(snap.workouts).toHaveLength(1)
    expect(snap.workouts[0].date).toBe("2026-02-01")
  })

  it("an empty CSV in replace mode clears everything", async () => {
    await importFitnotesCsv(csv(["2026-01-01,Bench Press,Chest,100,,5,,,,,wr"]))
    const result = await importFitnotesCsv(HEADER + "\n", { mode: "replace" })
    expect(result.imported).toBe(0)
    expect(currentSnapshot().sets).toHaveLength(0)
  })
})

describe("importFitnotesCsv: sample fixture", () => {
  it("imports the sample file and computes PRs without throwing", async () => {
    const text = readFileSync(FIXTURE, "utf8")
    const result = await importFitnotesCsv(text, { mode: "replace" })
    expect(result.imported).toBeGreaterThan(0)
    const snap = currentSnapshot()
    expect(snap.sets.length).toBe(result.imported)
    expect(snap.workouts.length).toBeGreaterThan(0)
    // PR pass ran: at least one weight/reps set should be flagged a record.
    expect(snap.sets.some((s) => s.is_pr)).toBe(true)
  })
})
