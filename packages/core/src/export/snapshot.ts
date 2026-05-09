/**
 * Local CSV/JSON exporters that read directly from a Snapshot. Pure functions —
 * no DOM, no filesystem — so the same code runs in both web (download via Blob)
 * and React Native (write via expo-file-system) hosts.
 */

import type { Snapshot } from "../store/schema"
import { SEED_EXERCISES } from "../store/seed"

const CSV_HEADERS = [
  "date",
  "exercise",
  "category",
  "kind",
  "weight_kg",
  "reps",
  "distance_m",
  "distance_unit",
  "time_seconds",
  "is_pr",
  "was_pr",
  "note",
  "gym",
  "workout_notes",
] as const

function exerciseLookup(snap: Snapshot) {
  const map = new Map<number, { name: string; category: string; kind: string }>()
  for (const e of snap.exercises) {
    map.set(e.id, { name: e.name, category: e.category, kind: e.kind })
  }
  for (const s of SEED_EXERCISES) {
    if (!map.has(s.id)) {
      map.set(s.id, {
        name: s.name,
        category: s.category,
        kind: s.category === "cardio" ? "distance_time" : "weight_reps",
      })
    }
  }
  return map
}

function escapeCsv(v: string): string {
  if (v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

function csvCell(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "boolean") return v ? "1" : "0"
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return ""
    return String(Number(v.toFixed(6))).replace(/\.?0+$/, "")
  }
  return escapeCsv(String(v).replace(/[\r\n]/g, " "))
}

export function buildCsv(snap: Snapshot): string {
  const exMap = exerciseLookup(snap)

  const workoutsById = new Map(snap.workouts.map((w) => [w.id, w]))
  const wesById = new Map(snap.workout_exercises.map((we) => [we.id, we]))

  const sets = snap.sets
    .filter((s) => !s.is_planned)
    .map((s) => {
      const we = wesById.get(s.workout_exercise_id)
      const w = we ? workoutsById.get(we.workout_id) : undefined
      return { s, we, w }
    })
    .filter(
      (row): row is { s: typeof row.s; we: NonNullable<typeof row.we>; w: NonNullable<typeof row.w> } =>
        row.we != null && row.w != null
    )
    .sort((a, b) => {
      if (a.w.date !== b.w.date) return a.w.date < b.w.date ? -1 : 1
      if (a.we.order !== b.we.order) return a.we.order - b.we.order
      if (a.s.order !== b.s.order) return a.s.order - b.s.order
      return a.s.id - b.s.id
    })

  const lines: string[] = [CSV_HEADERS.join(",")]
  for (const { s, we, w } of sets) {
    const ex = exMap.get(we.exercise_id) ?? {
      name: `#${we.exercise_id}`,
      category: "",
      kind: "weight_reps",
    }
    lines.push(
      [
        w.date,
        escapeCsv(ex.name),
        escapeCsv(ex.category),
        ex.kind,
        csvCell(s.weight),
        csvCell(s.reps),
        csvCell(s.distance_m),
        s.distance_unit_display || "",
        csvCell(s.time_seconds),
        csvCell(s.is_pr),
        csvCell(s.was_pr),
        csvCell(s.note),
        escapeCsv(w.gym || ""),
        csvCell(w.notes),
      ].join(",")
    )
  }
  return lines.join("\n") + "\n"
}

export function buildJson(snap: Snapshot, username = ""): string {
  const exMap = exerciseLookup(snap)
  const wesByWorkout = new Map<number, typeof snap.workout_exercises>()
  for (const we of snap.workout_exercises) {
    const arr = wesByWorkout.get(we.workout_id) ?? []
    arr.push(we)
    wesByWorkout.set(we.workout_id, arr)
  }
  const setsByWe = new Map<number, typeof snap.sets>()
  for (const s of snap.sets) {
    if (s.is_planned) continue
    const arr = setsByWe.get(s.workout_exercise_id) ?? []
    arr.push(s)
    setsByWe.set(s.workout_exercise_id, arr)
  }

  const workouts = [...snap.workouts]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
    .map((w) => ({
      id: w.id,
      date: w.date,
      started_at: w.started_at,
      finished_at: w.finished_at,
      gym: w.gym,
      notes: w.notes,
      exercises: (wesByWorkout.get(w.id) ?? [])
        .slice()
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map((we) => {
          const ex = exMap.get(we.exercise_id)
          return {
            order: we.order,
            exercise: {
              name: ex?.name ?? `#${we.exercise_id}`,
              category: ex?.category ?? "",
              kind: ex?.kind ?? "weight_reps",
              is_custom: snap.exercises.some((e) => e.id === we.exercise_id),
            },
            sets: (setsByWe.get(we.id) ?? [])
              .slice()
              .sort((a, b) => a.order - b.order || a.id - b.id)
              .map((s) => ({
                weight_kg: s.weight,
                reps: s.reps,
                distance_m: s.distance_m,
                distance_unit_display: s.distance_unit_display,
                time_seconds: s.time_seconds,
                is_pr: s.is_pr,
                was_pr: s.was_pr,
                note: s.note,
                order: s.order,
              })),
          }
        }),
    }))

  const customExercises = snap.exercises
    .filter((e) => e.is_custom)
    .map((e) => ({ name: e.name, category: e.category, kind: e.kind }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  const savedGyms = snap.gyms.map((g) => g.name).sort()

  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    weight_unit: "kg",
    user: { username },
    custom_exercises: customExercises,
    saved_gyms: savedGyms,
    workouts,
  }
  return JSON.stringify(payload, null, 2)
}

export function timestampedExportName(format: "csv" | "json"): string {
  const t = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .slice(0, 15)
  return `lift-export-${t}.${format}`
}
