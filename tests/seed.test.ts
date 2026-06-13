import { describe, it, expect } from "vitest"
import {
  SEED_EXERCISES,
  FIRST_CUSTOM_ID,
  isSeedId,
} from "@lift/core/store/seed"

describe("seed exercises", () => {
  it("assigns a contiguous 1..N id space", () => {
    SEED_EXERCISES.forEach((e, i) => {
      expect(e.id).toBe(i + 1)
    })
  })

  it("has no duplicate names", () => {
    const names = new Set(SEED_EXERCISES.map((e) => e.name))
    expect(names.size).toBe(SEED_EXERCISES.length)
  })

  it("marks every seed exercise as non-custom", () => {
    expect(SEED_EXERCISES.every((e) => e.is_custom === false)).toBe(true)
  })

  it("infers distance_time kind for cardio and weight_reps otherwise", () => {
    for (const e of SEED_EXERCISES) {
      if (e.category === "cardio") expect(e.kind).toBe("distance_time")
      else expect(e.kind).toBe("weight_reps")
    }
  })

  it("FIRST_CUSTOM_ID sits one past the last seed id", () => {
    expect(FIRST_CUSTOM_ID).toBe(SEED_EXERCISES.length + 1)
  })
})

describe("isSeedId", () => {
  it("is true within 1..N", () => {
    expect(isSeedId(1)).toBe(true)
    expect(isSeedId(SEED_EXERCISES.length)).toBe(true)
  })

  it("is false at 0 and past the seed range", () => {
    expect(isSeedId(0)).toBe(false)
    expect(isSeedId(FIRST_CUSTOM_ID)).toBe(false)
    expect(isSeedId(99999)).toBe(false)
  })
})
