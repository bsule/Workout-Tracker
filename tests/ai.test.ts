import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildUserPrompt,
  createProviderLookup,
  formatPlanSet,
  getProvider,
  parseAiPlanResponse,
} from "@lift/core/ai"
import type { Exercise } from "@lift/core"

describe("parseAiPlanResponse", () => {
  it("parses a plain JSON plan", () => {
    const plan = parseAiPlanResponse(
      JSON.stringify({
        days: [
          {
            date: "2026-01-05",
            exercises: [{ name: " Bench Press ", category: "chest", kind: "weight_reps", sets: [{ weight: 60, reps: 8 }] }],
          },
        ],
      })
    )
    expect(plan.days).toHaveLength(1)
    const ex = plan.days[0].exercises[0]
    expect(ex.name).toBe("Bench Press")
    expect(ex.category).toBe("chest")
    expect(ex.kind).toBe("weight_reps")
    expect(ex.sets[0]).toEqual({ weight: 60, reps: 8, distance_m: null, time_seconds: null, note: undefined })
  })

  it("extracts JSON wrapped in a markdown fence with prose around it", () => {
    const raw = 'Here you go:\n```json\n{"days":[{"date":"2026-01-06","exercises":[]}]}\n```\nEnjoy!'
    expect(parseAiPlanResponse(raw)).toEqual({ days: [{ date: "2026-01-06", exercises: [] }] })
  })

  it("coerces numeric strings and drops non-numbers to null", () => {
    const plan = parseAiPlanResponse(
      '{"days":[{"date":"2026-01-05","exercises":[{"name":"Run","sets":[{"distance_m":"400","time_seconds":"x","note":"easy"}]}]}]}'
    )
    expect(plan.days[0].exercises[0].sets[0]).toEqual({
      weight: null,
      reps: null,
      distance_m: 400,
      time_seconds: null,
      note: "easy",
    })
    expect(plan.days[0].exercises[0].category).toBeUndefined()
  })

  it("skips days with a bad date and exercises with no name", () => {
    const plan = parseAiPlanResponse(
      '{"days":[{"date":"Jan 5","exercises":[]},{"date":"2026-01-07","exercises":[{"name":"  "},{"name":"Squat"}]}]}'
    )
    expect(plan.days.map((d) => d.date)).toEqual(["2026-01-07"])
    expect(plan.days[0].exercises.map((e) => e.name)).toEqual(["Squat"])
  })

  it("throws on text with no JSON object", () => {
    expect(() => parseAiPlanResponse("Sorry, I can't help with that.")).toThrow("not valid JSON")
  })

  it("throws when the days array is missing", () => {
    expect(() => parseAiPlanResponse('{"plan":[]}')).toThrow('missing a "days" array')
  })
})

describe("buildUserPrompt", () => {
  const library = [{ id: 1, name: "Bench Press", category: "chest", kind: "weight_reps" } as Exercise]

  it("lists every plan date, the library, the guidance, and the schema", () => {
    const prompt = buildUserPrompt({
      planDates: ["2026-01-05", "2026-01-06"],
      weightUnit: "lb",
      exerciseLibrary: library,
      history: [],
      historyDisabled: false,
      historyFiltered: false,
      comment: "  push day  ",
    })
    expect(prompt).toContain("  - 2026-01-05\n  - 2026-01-06")
    expect(prompt).toContain("in lb")
    expect(prompt).toContain("prefer these names")
    expect(prompt).toContain("  - Bench Press (chest, weight_reps)")
    expect(prompt).toContain("No completed workouts found")
    expect(prompt).toContain("User guidance: push day")
    expect(prompt).toContain("Respond with JSON matching this exact schema")
  })

  it("uses the hard constraint when restricted and tags history weights with the unit", () => {
    const prompt = buildUserPrompt({
      planDates: ["2026-01-05"],
      weightUnit: "kg",
      exerciseLibrary: library,
      history: [
        {
          date: "2026-01-01",
          exercises: [{ name: "Bench Press", category: "chest", kind: "weight_reps", sets: [{ weight: 80, reps: 5 }] }],
        },
      ],
      historyDisabled: false,
      historyFiltered: true,
      restrictToLibrary: true,
      comment: "",
    })
    expect(prompt).toContain("HARD CONSTRAINT")
    expect(prompt).toContain("filtered to the exercises the user selected")
    expect(prompt).toContain('"weight":80,"reps":5,"unit":"kg"')
    expect(prompt).not.toContain("User guidance")
  })
})

describe("formatPlanSet", () => {
  it("formats each set shape", () => {
    expect(formatPlanSet({ weight: 60, reps: 8 }, "kg")).toBe("60kg×8")
    expect(formatPlanSet({ reps: 12 }, "kg")).toBe("×12")
    expect(formatPlanSet({ distance_m: 400, time_seconds: 90 }, "kg")).toBe("400m / 90s")
    expect(formatPlanSet({ distance_m: 400 }, "kg")).toBe("400m")
    expect(formatPlanSet({ time_seconds: 60 }, "kg")).toBe("60s")
    expect(formatPlanSet({}, "kg")).toBe("set")
  })
})

describe("anthropic provider", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function captureHeaders(): { headers: Record<string, string> | undefined } {
    const seen: { headers: Record<string, string> | undefined } = { headers: undefined }
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.headers = init?.headers as Record<string, string>
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 })
    }) as typeof fetch
    return seen
  }

  const opts = { systemPrompt: "s", userPrompt: "u", apiKey: "k" }

  it("omits the browser-access header by default (mobile)", async () => {
    const seen = captureHeaders()
    await expect(getProvider("anthropic").generate(opts)).resolves.toBe("{}")
    expect(seen.headers).toEqual({
      "Content-Type": "application/json",
      "x-api-key": "k",
      "anthropic-version": "2023-06-01",
    })
  })

  it("sends the browser-access header when configured (web)", async () => {
    const seen = captureHeaders()
    await createProviderLookup({ anthropic: { directBrowserAccess: true } })("anthropic").generate(opts)
    expect(seen.headers?.["anthropic-dangerous-direct-browser-access"]).toBe("true")
  })
})
