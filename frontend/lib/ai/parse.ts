import type { AiPlanResponse, AiPlanDay, AiPlanExercise, AiPlanSet } from "./types"

export function parseAiPlanResponse(raw: string): AiPlanResponse {
  const json = extractJson(raw)
  if (!json || typeof json !== "object") {
    throw new Error("AI response is not a JSON object")
  }
  const daysRaw = (json as { days?: unknown }).days
  if (!Array.isArray(daysRaw)) {
    throw new Error('AI response is missing a "days" array')
  }
  const days: AiPlanDay[] = []
  for (const d of daysRaw) {
    if (!d || typeof d !== "object") continue
    const date = (d as { date?: unknown }).date
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const exsRaw = (d as { exercises?: unknown }).exercises
    const exercises: AiPlanExercise[] = []
    if (Array.isArray(exsRaw)) {
      for (const e of exsRaw) {
        if (!e || typeof e !== "object") continue
        const name = (e as { name?: unknown }).name
        if (typeof name !== "string" || !name.trim()) continue
        const setsRaw = (e as { sets?: unknown }).sets
        const sets: AiPlanSet[] = []
        if (Array.isArray(setsRaw)) {
          for (const s of setsRaw) {
            if (!s || typeof s !== "object") continue
            sets.push({
              weight: numOrNull((s as any).weight),
              reps: numOrNull((s as any).reps),
              distance_m: numOrNull((s as any).distance_m),
              time_seconds: numOrNull((s as any).time_seconds),
              note: typeof (s as any).note === "string" ? (s as any).note : undefined,
            })
          }
        }
        exercises.push({
          name: name.trim(),
          category: optStr((e as any).category) as any,
          kind: optStr((e as any).kind) as any,
          sets,
        })
      }
    }
    days.push({ date, exercises })
  }
  return { days }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // continue
  }
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // fall through
    }
  }
  throw new Error("AI response was not valid JSON")
}
