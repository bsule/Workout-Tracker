import { describe, expect, it } from "vitest"
import {
  COLOR_PALETTE,
  DEFAULT_LABELS,
  addCategoryEntry,
  canResetCategory,
  customOrderFrom,
  deriveCategoryStyles,
  isDefaultCategory,
  parseCategoryEntries,
  parseCategoryEntriesJson,
  removeCategoryEntry,
  resetCategoryEntry,
  setCategoryColor,
  setCategoryLabel,
  slugify,
  stateFromEntries,
  type CategoryStylesState,
} from "@lift/core/categoryStyles"
import { DEFAULT_CATEGORIES } from "@lift/core"

const empty: CategoryStylesState = { entries: {}, customOrder: [] }

describe("slugify", () => {
  it("lowercases, dashes runs of other characters, trims dashes", () => {
    expect(slugify("  Upper Body!! ")).toBe("upper-body")
    expect(slugify("--Grip & Forearms--")).toBe("grip-forearms")
  })
  it("caps at 32 characters", () => {
    expect(slugify("a".repeat(40))).toHaveLength(32)
  })
  it("is empty when nothing usable is left", () => {
    expect(slugify("!!!")).toBe("")
  })
})

describe("parseCategoryEntries", () => {
  it("keeps valid entries and trims strings", () => {
    const out = parseCategoryEntries({
      chest: { label: "  Pecs ", color: " #fff " },
      grip: { custom: true, label: "Grip" },
    })
    expect(out).toEqual({
      chest: { label: "Pecs", color: "#fff" },
      grip: { custom: true, label: "Grip" },
    })
  })
  it("drops bad slugs, non-objects, and empty entries", () => {
    const out = parseCategoryEntries({
      "Bad Slug": { label: "x" },
      "-lead": { label: "x" },
      legs: "red",
      back: { label: "  ", color: "" },
      abs: null,
    })
    expect(out).toEqual({})
  })
  it("handles non-object input and bad JSON", () => {
    expect(parseCategoryEntries(null)).toEqual({})
    expect(parseCategoryEntries("x")).toEqual({})
    expect(parseCategoryEntriesJson("{not json")).toEqual({})
    expect(parseCategoryEntriesJson(null)).toEqual({})
    expect(parseCategoryEntriesJson('{"chest":{"color":"#000"}}')).toEqual({
      chest: { color: "#000" },
    })
  })
})

describe("custom order", () => {
  it("lists custom entries, never a built-in flagged custom", () => {
    expect(
      customOrderFrom({
        grip: { custom: true, label: "Grip" },
        chest: { custom: true, color: "#000" },
        neck: { custom: true, label: "Neck" },
      })
    ).toEqual(["grip", "neck"])
  })
})

describe("setCategoryLabel", () => {
  it("stores a built-in override and drops it when set back to default", () => {
    let e = setCategoryLabel({}, "chest", "Pecs")
    expect(e.chest).toEqual({ label: "Pecs" })
    e = setCategoryLabel(e, "chest", "Chest")
    expect(e.chest).toBeUndefined()
  })
  it("keeps a built-in color when the label resets", () => {
    const e = setCategoryLabel({ chest: { label: "Pecs", color: "#111" } }, "chest", " ")
    expect(e.chest).toEqual({ color: "#111" })
  })
  it("falls a blank custom label back to its slug", () => {
    const e = setCategoryLabel({ grip: { custom: true, label: "Grip" } }, "grip", "  ")
    expect(e.grip).toEqual({ custom: true, label: "grip" })
  })
})

describe("setCategoryColor / resetCategoryEntry", () => {
  it("marks custom slugs custom and leaves built-ins unflagged", () => {
    expect(setCategoryColor({}, "grip", "#123").grip).toEqual({ custom: true, color: "#123" })
    expect(setCategoryColor({}, "chest", "#123").chest).toEqual({ color: "#123" })
  })
  it("resets only built-ins", () => {
    const e = { chest: { color: "#1" }, grip: { custom: true, label: "Grip" } }
    expect(resetCategoryEntry(e, "chest").chest).toBeUndefined()
    expect(resetCategoryEntry(e, "grip")).toBe(e)
  })
})

describe("addCategoryEntry / removeCategoryEntry", () => {
  it("adds with a slug from the label", () => {
    const r = addCategoryEntry(empty, " Grip ", COLOR_PALETTE[0])!
    expect(r.slug).toBe("grip")
    expect(r.state.customOrder).toEqual(["grip"])
    expect(r.state.entries.grip).toEqual({ custom: true, label: "Grip", color: COLOR_PALETTE[0] })
  })
  it("suffixes on a clash with a built-in or an existing custom", () => {
    const a = addCategoryEntry(empty, "Chest", "#1")!
    expect(a.slug).toBe("chest-2")
    const b = addCategoryEntry(a.state, "Chest", "#1")!
    expect(b.slug).toBe("chest-3")
  })
  it("keeps a suffixed long slug within 32 characters", () => {
    const long = "x".repeat(32)
    const a = addCategoryEntry(empty, long, "#1")!
    const b = addCategoryEntry(a.state, long, "#1")!
    expect(b.slug).toBe("x".repeat(30) + "-2")
  })
  it("refuses a label with no usable characters", () => {
    expect(addCategoryEntry(empty, "!!", "#1")).toBeNull()
  })
  it("removes custom categories only", () => {
    const a = addCategoryEntry(empty, "Grip", "#1")!
    const removed = removeCategoryEntry(a.state, "grip")
    expect(removed.customOrder).toEqual([])
    expect(removed.entries.grip).toBeUndefined()
    expect(removeCategoryEntry(a.state, "chest")).toBe(a.state)
  })
})

describe("deriveCategoryStyles", () => {
  it("lists built-ins first, then customs, with labels and set colors only", () => {
    const state = stateFromEntries({
      chest: { label: "Pecs" },
      legs: { color: "#abc" },
      grip: { custom: true, label: "Grip", color: "#def" },
    })
    const view = deriveCategoryStyles(state)
    expect(view.categories).toEqual([...DEFAULT_CATEGORIES, "grip"])
    expect(view.customCategories).toEqual(["grip"])
    expect(view.labels.chest).toBe("Pecs")
    expect(view.labels.back).toBe(DEFAULT_LABELS.back)
    expect(view.labels.grip).toBe("Grip")
    expect(view.colors).toEqual({ legs: "#abc", grip: "#def" })
  })
  it("offers reset only for a built-in with an override", () => {
    const view = deriveCategoryStyles(
      stateFromEntries({
        chest: { label: "Pecs" },
        legs: { color: "#abc" },
        grip: { custom: true, label: "Grip", color: "#def" },
      })
    )
    expect(canResetCategory(view, "chest")).toBe(true)
    expect(canResetCategory(view, "legs")).toBe(true)
    expect(canResetCategory(view, "back")).toBe(false)
    expect(canResetCategory(view, "grip")).toBe(false)
    expect(isDefaultCategory("back")).toBe(true)
    expect(isDefaultCategory("grip")).toBe(false)
  })
})
