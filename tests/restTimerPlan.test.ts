import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import * as M from "@lift/core/store/mutations"
import { parse, serialize } from "@lift/core/store/blob"
import { resetStore, currentSnapshot } from "./helpers/store"
import {
  CUTOFF_DEFAULT_S,
  clampCutoff,
  decideOnForeground,
  decideOnSet,
  formatCutoff,
  lastSetAnchorMs,
  parseCutoff,
  restTimerSettings,
  tickerAnchor,
} from "../mobile/src/restTimer/plan"

describe("rest timer settings", () => {
  it("defaults to on with a 6:00 cutoff when the keys are missing", () => {
    expect(restTimerSettings({})).toEqual({ enabled: true, cutoffS: 360 })
    expect(CUTOFF_DEFAULT_S).toBe(360)
  })

  it("keeps an explicit off and a valid cutoff", () => {
    expect(
      restTimerSettings({ rest_timer_activity: false, rest_timer_cutoff_s: 390 })
    ).toEqual({ enabled: false, cutoffS: 390 })
  })

  it("clamps a stored cutoff outside 0:30..15:00 and ignores junk", () => {
    expect(restTimerSettings({ rest_timer_cutoff_s: 5 }).cutoffS).toBe(30)
    expect(restTimerSettings({ rest_timer_cutoff_s: 3600 }).cutoffS).toBe(900)
    expect(restTimerSettings({ rest_timer_cutoff_s: Number.NaN }).cutoffS).toBe(360)
    expect(
      restTimerSettings({ rest_timer_cutoff_s: "6" as unknown as number }).cutoffS
    ).toBe(360)
  })
})

describe("cutoff text", () => {
  it("reads bare minutes", () => {
    expect(parseCutoff("6")).toBe(360)
    expect(parseCutoff(" 15 ")).toBe(900)
    expect(parseCutoff("0")).toBe(0)
  })

  it("reads minutes and seconds", () => {
    expect(parseCutoff("6:30")).toBe(390)
    expect(parseCutoff("06:30")).toBe(390)
    expect(parseCutoff("0:45")).toBe(45)
    expect(parseCutoff("15:00")).toBe(900)
  })

  it("rejects text that is not a time", () => {
    for (const bad of ["", "abc", "6:3", "6:60", "6.5", "-1", "6:30:00", "123", ":30"]) {
      expect(parseCutoff(bad), bad).toBeNull()
    }
  })

  it("does not clamp; the caller does", () => {
    expect(parseCutoff("20:00")).toBe(1200)
    expect(clampCutoff(1200)).toBe(900)
    expect(clampCutoff(10)).toBe(30)
    expect(clampCutoff(390.4)).toBe(390)
  })

  it("formats as m:ss", () => {
    expect(formatCutoff(360)).toBe("6:00")
    expect(formatCutoff(390)).toBe("6:30")
    expect(formatCutoff(45)).toBe("0:45")
    expect(formatCutoff(900)).toBe("15:00")
  })

  it("round-trips every valid value", () => {
    for (let s = 30; s <= 900; s++) {
      expect(parseCutoff(formatCutoff(s))).toBe(s)
    }
  })
})

describe("decideOnSet", () => {
  const now = 1_000_000

  it("starts when nothing is showing", () => {
    expect(decideOnSet(null, now, true)).toBe("start")
  })

  it("updates in place while the last timer is inside its cutoff", () => {
    expect(decideOnSet({ endsAt: now + 1 }, now, true)).toBe("update")
  })

  it("starts fresh once the last timer has passed its cutoff", () => {
    expect(decideOnSet({ endsAt: now }, now, true)).toBe("start")
    expect(decideOnSet({ endsAt: now - 5000 }, now, true)).toBe("start")
  })

  it("ends a showing timer when the feature is off, else does nothing", () => {
    expect(decideOnSet({ endsAt: now + 1 }, now, false)).toBe("end")
    expect(decideOnSet(null, now, false)).toBe("none")
  })
})

describe("tickerAnchor", () => {
  const set = 1_000_000
  const day = "2026-09-22"

  it("counts from the last set when there is no mark", () => {
    expect(tickerAnchor(set, null, day)).toBe(set)
    expect(tickerAnchor(null, null, day)).toBeNull()
  })

  it("counts from a reset made after the last set", () => {
    expect(tickerAnchor(set, { kind: "reset", atMs: set + 5000, date: day }, day)).toBe(set + 5000)
  })

  it("hides after a stop made after the last set", () => {
    expect(tickerAnchor(set, { kind: "stop", atMs: set + 5000, date: day }, day)).toBeNull()
  })

  it("lets a set saved after the mark take over", () => {
    expect(tickerAnchor(set, { kind: "reset", atMs: set - 5000, date: day }, day)).toBe(set)
    expect(tickerAnchor(set, { kind: "stop", atMs: set - 5000, date: day }, day)).toBe(set)
  })

  it("ignores a mark made on another workout day", () => {
    const other = "2026-09-21"
    expect(tickerAnchor(set, { kind: "reset", atMs: set + 5000, date: day }, other)).toBe(set)
    expect(tickerAnchor(null, { kind: "reset", atMs: set + 5000, date: day }, other)).toBeNull()
    expect(tickerAnchor(set, { kind: "stop", atMs: set + 5000, date: day }, other)).toBe(set)
    expect(tickerAnchor(set, { kind: "reset", atMs: set + 5000, date: day }, null)).toBe(set)
  })
})

describe("lastSetAnchorMs", () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const T = Date.UTC(2026, 8, 22, 12, 0, 0)
  const logged = (ms: number) => ({ is_planned: false, created_at: iso(ms) })
  const planned = (ms: number) => ({ is_planned: true, created_at: iso(ms) })

  it("prefers a set that was just saved", () => {
    expect(lastSetAnchorMs({ pendingAddMs: T + 9, sets: [logged(T)], fallbackIso: null })).toBe(T + 9)
  })

  it("uses the newest logged row, skipping planned rows after it", () => {
    const sets = [logged(T), logged(T + 60_000), planned(T + 999_000)]
    expect(lastSetAnchorMs({ pendingAddMs: null, sets, fallbackIso: iso(T - 5) })).toBe(T + 60_000)
  })

  it("treats a missing is_planned as logged", () => {
    const sets = [{ created_at: iso(T) }]
    expect(lastSetAnchorMs({ pendingAddMs: null, sets, fallbackIso: null })).toBe(T)
  })

  it("falls back to another exercise's last set", () => {
    const sets = [planned(T)]
    expect(lastSetAnchorMs({ pendingAddMs: null, sets, fallbackIso: iso(T - 5) })).toBe(T - 5)
    expect(lastSetAnchorMs({ pendingAddMs: null, sets: [], fallbackIso: iso(T - 5) })).toBe(T - 5)
  })

  it("does not reach past an unreadable newest row to an older one", () => {
    const sets = [logged(T), { is_planned: false, created_at: "junk" }]
    expect(lastSetAnchorMs({ pendingAddMs: null, sets, fallbackIso: iso(T - 5) })).toBe(T - 5)
  })

  it("is null with nothing to count from", () => {
    expect(lastSetAnchorMs({ pendingAddMs: null, sets: [], fallbackIso: null })).toBeNull()
    expect(lastSetAnchorMs({ pendingAddMs: null, sets: [], fallbackIso: "junk" })).toBeNull()
  })
})

describe("decideOnForeground", () => {
  const now = 1_000_000

  it("does nothing when no timer is showing", () => {
    expect(decideOnForeground(null, now, true)).toBe("none")
    expect(decideOnForeground(null, now, false)).toBe("none")
  })

  it("keeps a timer inside its cutoff, even from an earlier process", () => {
    expect(decideOnForeground({ endsAt: now + 1 }, now, true)).toBe("none")
  })

  it("ends a timer past its cutoff", () => {
    expect(decideOnForeground({ endsAt: now }, now, true)).toBe("end")
  })

  it("ends any timer when the feature is off", () => {
    expect(decideOnForeground({ endsAt: now + 60_000 }, now, false)).toBe("end")
  })
})

describe("rest timer settings in the snapshot", () => {
  beforeEach(() => resetStore())

  it("stores both keys through updateSettings and reads them back", () => {
    M.updateSettings({ rest_timer_activity: false, rest_timer_cutoff_s: 390 })
    expect(restTimerSettings(currentSnapshot().settings)).toEqual({
      enabled: false,
      cutoffS: 390,
    })
  })

  it("survives a blob round-trip with no migration", async () => {
    M.updateSettings({ rest_timer_activity: false, rest_timer_cutoff_s: 45 })
    const { snapshot, migrated } = await parse(await serialize(currentSnapshot()))
    expect(migrated).toBe(false)
    expect(snapshot.settings.rest_timer_activity).toBe(false)
    expect(snapshot.settings.rest_timer_cutoff_s).toBe(45)
  })
})

describe("iOS cutoff (source guards)", () => {
  // No Swift test target exists, so these read the source. Each guards a bug
  // that shows only on a device, long after the change that caused it.
  const swift = () =>
    readFileSync(resolve(__dirname, "../mobile/modules/rest-timer/ios/RestTimerModule.swift"), "utf8")

  it("arms the cutoff for a timer an earlier process started", () => {
    const current = swift().split('AsyncFunction("current")')[1].split("AsyncFunction(")[0]
    expect(current).toContain("self.armCutoff(endsAt)")
  })

  it("ends only the activity the cutoff was armed for, never all of them", () => {
    const arm = swift().split("private func armCutoff")[1].split("private func cancelCutoff")[0]
    expect(arm).toContain("RestTimerActivities.end(endingAt: endsAtMs)")
    expect(arm).not.toContain("endAll()")
  })
})

describe("RestTimerAttributes copies", () => {
  // ActivityKit matches the app's activity to the widget extension by the
  // Swift type and its encoded state. Two drifting copies means a Live
  // Activity that starts but draws nothing, which no other check catches.
  it("are identical in the native module and the widget target", () => {
    const root = resolve(__dirname, "../mobile")
    const inModule = readFileSync(
      resolve(root, "modules/rest-timer/ios/RestTimerAttributes.swift"),
      "utf8"
    )
    const inTarget = readFileSync(
      resolve(root, "targets/rest-timer/RestTimerAttributes.swift"),
      "utf8"
    )
    expect(inTarget).toBe(inModule)
  })
})
