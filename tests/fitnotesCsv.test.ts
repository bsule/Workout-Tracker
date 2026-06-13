import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  previewFitnotesCsv,
  importFitnotesCsv,
  FITNOTES_HEADERS,
} from "@lift/core/import"
import { installMemoryStorage, currentSnapshot, resetStore } from "./helpers/store"

const HEADER = FITNOTES_HEADERS.join(",")

function csv(rows: string[]): string {
  return [HEADER, ...rows].join("\n") + "\n"
}

const FIXTURE = fileURLToPath(
  new URL("../test_dbs/FitNotes-2026-05-05-015918.csv", import.meta.url)
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

  it("previews the real exported fixture as fitnotes", () => {
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

describe("importFitnotesCsv: real fixture", () => {
  it("imports the full exported file and computes PRs without throwing", async () => {
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
