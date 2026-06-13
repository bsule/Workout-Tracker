import { describe, it, expect } from "vitest"
import {
  fromKg,
  toKg,
  roundForDisplay,
  formatWeight,
  defaultStep,
  KG_PER_LB,
  LB_PER_KG,
} from "@lift/core/units"

describe("units: fromKg", () => {
  it("returns the value unchanged in kg", () => {
    expect(fromKg(100, "kg")).toBe(100)
  })

  it("converts kg to lb", () => {
    expect(fromKg(100, "lb")).toBeCloseTo(220.462, 2)
  })

  it("treats null/undefined as 0", () => {
    expect(fromKg(null, "kg")).toBe(0)
    expect(fromKg(undefined, "lb")).toBe(0)
  })

  it("treats non-finite as 0", () => {
    expect(fromKg(NaN, "kg")).toBe(0)
    expect(fromKg(Infinity, "lb")).toBe(0)
  })
})

describe("units: toKg", () => {
  it("returns the value unchanged in kg", () => {
    expect(toKg(60, "kg")).toBe(60)
  })

  it("converts lb to kg", () => {
    expect(toKg(220.462, "lb")).toBeCloseTo(100, 2)
  })

  it("treats non-finite as 0", () => {
    expect(toKg(NaN, "lb")).toBe(0)
  })

  it("round-trips kg -> lb -> kg", () => {
    const kg = 142.5
    expect(toKg(fromKg(kg, "lb"), "lb")).toBeCloseTo(kg, 6)
  })
})

describe("units: constants", () => {
  it("LB_PER_KG is the reciprocal of KG_PER_LB", () => {
    expect(KG_PER_LB * LB_PER_KG).toBeCloseTo(1, 12)
  })
})

describe("units: roundForDisplay", () => {
  it("rounds to one decimal", () => {
    expect(roundForDisplay(2.449, "kg")).toBe(2.4)
    expect(roundForDisplay(2.45, "kg")).toBe(2.5)
  })

  it("treats non-finite as 0", () => {
    expect(roundForDisplay(NaN, "lb")).toBe(0)
  })
})

describe("units: formatWeight", () => {
  it("renders an em-dash for null (cardio)", () => {
    expect(formatWeight(null, "kg")).toBe("—")
  })

  it("drops the decimal for whole numbers", () => {
    expect(formatWeight(100, "kg")).toBe("100")
  })

  it("keeps one decimal for fractional values", () => {
    expect(formatWeight(2.5, "kg")).toBe("2.5")
  })

  it("converts to lb before formatting", () => {
    // 100 kg -> 220.46 lb -> rounded to 220.5
    expect(formatWeight(100, "lb")).toBe("220.5")
  })

  it("renders 0 (not em-dash) for an actual zero weight", () => {
    expect(formatWeight(0, "kg")).toBe("0")
  })
})

describe("units: defaultStep", () => {
  it("is 2.5 for kg and 5 for lb", () => {
    expect(defaultStep("kg")).toBe(2.5)
    expect(defaultStep("lb")).toBe(5)
  })
})
