import type { Exercise } from "@lift/core"
import type { HistoryDay } from "./types"

export const SYSTEM_PROMPT = [
  "You are a strength-and-conditioning coach generating planned workouts for a fitness-tracking app.",
  "Output STRICT JSON only — no markdown, no commentary, no preamble. Your entire response must be a single JSON object matching the schema the user gives you.",
  "Use the user's preferred weight unit for every set. Generate realistic, achievable target weights and reps based on the user's history (when provided) — apply gentle progressive overload.",
  "When a recent set's exercise is in the user's library, prefer that exact `name` so the app can reuse the existing exercise. Otherwise, you may invent a new exercise; pick a sensible `category` and `kind`.",
  "Categories: abs, back, biceps, cardio, chest, legs, shoulders, triceps.",
  "Exercise kinds: weight_reps (default — fill weight + reps), bodyweight_reps (fill reps only), distance_time (fill distance_m and/or time_seconds), time_only (fill time_seconds only).",
  "Always populate one entry in `days` for EVERY requested date — even if you give the user a rest day, return that date with an empty `exercises` array.",
  "Every set must include the fields appropriate for its `kind` and may include a short `note`.",
].join("\n")

interface BuildOpts {
  planDates: string[]
  weightUnit: "kg" | "lb"
  exerciseLibrary: Exercise[]
  history: HistoryDay[]
  /** True when the user explicitly disabled the history block. */
  historyDisabled: boolean
  /** True when the user filtered to a specific exercise set (we mention it). */
  historyFiltered: boolean
  comment: string
}

const SCHEMA_BLOCK = `Respond with JSON matching this exact schema:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "exercises": [
        {
          "name": "Bench Press",
          "category": "chest",
          "kind": "weight_reps",
          "sets": [
            { "weight": 60, "reps": 8 },
            { "weight": 65, "reps": 6 }
          ]
        }
      ]
    }
  ]
}`

export function buildUserPrompt(opts: BuildOpts): string {
  const {
    planDates,
    weightUnit,
    exerciseLibrary,
    history,
    historyDisabled,
    historyFiltered,
    comment,
  } = opts

  const libraryNames = exerciseLibrary.slice(0, 80).map((e) => `${e.name} (${e.category}, ${e.kind})`)

  const lines: string[] = []
  lines.push(`Weight unit: ${weightUnit}.`)
  lines.push("")
  lines.push("Generate a planned workout for EACH of these dates:")
  for (const d of planDates) lines.push(`  - ${d}`)
  lines.push("")

  if (libraryNames.length) {
    lines.push("User's existing exercise library (prefer these names when reasonable):")
    for (const n of libraryNames) lines.push(`  - ${n}`)
    lines.push("")
  }

  if (historyDisabled) {
    lines.push("The user has chosen NOT to share workout history. Plan based only on the guidance below.")
    lines.push("")
  } else if (history.length === 0) {
    lines.push(
      historyFiltered
        ? "No matching workouts found in the selected history range for the chosen exercises."
        : "No completed workouts found in the selected history range."
    )
    lines.push("")
  } else {
    lines.push(
      historyFiltered
        ? "Recent completed workouts (filtered to the exercises the user selected):"
        : "Recent completed workouts:"
    )
    lines.push(JSON.stringify(history))
    lines.push("")
  }

  if (comment.trim()) {
    lines.push(`User guidance: ${comment.trim()}`)
    lines.push("")
  }

  lines.push(SCHEMA_BLOCK)
  return lines.join("\n")
}
