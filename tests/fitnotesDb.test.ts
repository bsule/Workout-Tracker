import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { unzipSync } from "fflate"
import { buildFitnotesDb, type SqlJsModule } from "@lift/core/export"
import { SEED_EXERCISES } from "@lift/core/store/seed"
import { blankSnapshot, exercise, workout, we, set } from "./helpers/build"

// The real FitNotes skeleton the web app ships, and sql.js's Node build.
const skeletonBytes = new Uint8Array(
  readFileSync(new URL("../frontend/public/data/fitnotes_skeleton.fitnotesdb", import.meta.url))
)
const initSqlJs = createRequire(import.meta.url)("sql.js")

async function exportAndOpen(snap: ReturnType<typeof blankSnapshot>) {
  const SQL = await initSqlJs()
  const zipped = await buildFitnotesDb(snap, { skeletonBytes, SQL: SQL as SqlJsModule })
  const db = new SQL.Database(Object.values(unzipSync(zipped))[0])
  const count = (table: string) => db.exec(`SELECT count(*) FROM ${table}`)[0].values[0][0]
  const names = () =>
    db.exec(
      "SELECT e.ZNAME FROM ZWORKOUTEXERCISE we JOIN ZEXERCISE e ON e.Z_PK = we.ZEXERCISE ORDER BY we.ZINDEX"
    )[0]?.values.flat() ?? []
  return { count, names }
}

describe("buildFitnotesDb", () => {
  it("exports sets logged on a built-in exercise", async () => {
    // Built-ins live in SEED_EXERCISES, not snap.exercises, until edited.
    const bench = SEED_EXERCISES.find((e) => e.name === "Bench Press")!
    const snap = blankSnapshot()
    snap.workouts = [workout(1, "2026-10-28")]
    snap.workout_exercises = [we(10, 1, bench.id)]
    snap.sets = [set(100, 10, { weight: 80, reps: 8 }), set(101, 10, { weight: 80, reps: 7 })]

    const out = await exportAndOpen(snap)
    expect(out.count("ZWORKOUTEXERCISE")).toBe(1)
    expect(out.count("ZWORKOUTSET")).toBe(2)
    expect(out.names()).toEqual(["Bench Press"])
  })

  it("exports built-in and custom exercises side by side", async () => {
    const squat = SEED_EXERCISES.find((e) => e.name === "Back Squat")!
    const snap = blankSnapshot()
    snap.exercises = [exercise(5001, "Zercher Squat", "legs")]
    snap.workouts = [workout(1, "2026-10-28")]
    snap.workout_exercises = [we(10, 1, squat.id, 0), we(11, 1, 5001, 1)]
    snap.sets = [set(100, 10, { weight: 100, reps: 5 }), set(101, 11, { weight: 60, reps: 8 })]

    const out = await exportAndOpen(snap)
    expect(out.count("ZWORKOUTSET")).toBe(2)
    expect(out.names()).toEqual(["Back Squat", "Zercher Squat"])
  })
})
