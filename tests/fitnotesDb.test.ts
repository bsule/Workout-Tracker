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
  const workouts = () =>
    db.exec("SELECT ZDATE, ZNOTES FROM ZWORKOUT ORDER BY Z_PK")[0]?.values ?? []
  const exercisesPerWorkout = () =>
    db.exec(
      "SELECT w.ZNOTES, count(we.Z_PK) FROM ZWORKOUT w LEFT JOIN ZWORKOUTEXERCISE we ON we.ZWORKOUT = w.Z_PK GROUP BY w.Z_PK ORDER BY w.Z_PK"
    )[0]?.values ?? []
  return { count, names, workouts, exercisesPerWorkout }
}

const appleMidnight = (date: string) => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(2001, 0, 1)) / 1000

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

  it("keeps note-only days: a workout with no exercises, and a day note with no workout", async () => {
    const bench = SEED_EXERCISES.find((e) => e.name === "Bench Press")!
    const snap = blankSnapshot()
    snap.workouts = [
      workout(1, "2026-10-01"),
      { ...workout(2, "2026-10-03"), notes: "rest day, stretched" },
      workout(3, "2026-10-04"),
    ]
    snap.workout_exercises = [we(10, 1, bench.id)]
    snap.sets = [set(100, 10, { weight: 80, reps: 8 })]
    snap.day_notes = [
      { date: "2026-10-02", text: "sick" },
      { date: "2026-10-03", text: "knee sore" },
    ]

    const out = await exportAndOpen(snap)
    // 2026-10-04 has an empty workout and no note: nothing to keep.
    expect(out.workouts()).toEqual([
      [appleMidnight("2026-10-01"), null],
      [appleMidnight("2026-10-02"), "sick"],
      [appleMidnight("2026-10-03"), "knee sore\nrest day, stretched"],
    ])
    expect(out.exercisesPerWorkout()).toEqual([
      [null, 1],
      ["sick", 0],
      ["knee sore\nrest day, stretched", 0],
    ])
    expect(out.count("ZWORKOUTSET")).toBe(1)
  })
})
