/**
 * Mobile sign-out (mobile/src/store/bootstrap.ts): the rest timer ends and
 * forgets its manual reset/stop and its engine, waiting edits get their
 * restore point, the engine closes, and the next sign-in waits for all of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls = vi.hoisted(() => [] as string[])
const sessions = vi.hoisted(() => ({
  release: null as null | (() => void),
  hold: false,
}))

vi.stubGlobal("requestIdleCallback", () => 0)
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
}))
vi.mock("../mobile/src/restTimer", () => ({
  restTimer: {
    disable: () => calls.push("timer ended"),
    clearMark: () => calls.push("timer mark cleared"),
    bindEngine: (client: unknown) => calls.push(client ? "timer bound" : "timer unbound"),
    reconcile: () => calls.push("timer reconciled"),
  },
}))
vi.mock("../mobile/src/sync/engineSync", () => ({
  mobileSync: { reset: () => calls.push("sync reset"), maybeAutoSync: async () => {} },
}))
vi.mock("../mobile/src/store/restorePoints", () => ({
  saveRestorePointNow: async () => { calls.push("restore point saved") },
  cancelRestorePoint: () => {},
}))
vi.mock("../mobile/src/engine/mobileEngine", () => {
  let state: any = { status: "closed" }
  return {
    mobileSessions: {
      getSnapshot: () => state,
      get session() { return state.status === "ready" ? state.session : null },
      switchAccount: async (key: string | null) => {
        calls.push(key ? `open ${key}` : "engine closed")
        if (!key) {
          if (sessions.hold) await new Promise<void>((r) => (sessions.release = r))
          state = { status: "closed" }
          return
        }
        state = { status: "ready", session: { accountKey: key, client: { prefetch: async () => {} } } }
      },
    },
  }
})

import { openForUser, unloadForSignOut } from "../mobile/src/store/bootstrap"

beforeEach(() => {
  calls.length = 0
  sessions.hold = false
})

describe("unloadForSignOut", () => {
  it("ends the timer, saves a restore point, and closes the engine", async () => {
    await unloadForSignOut()
    expect(calls).toEqual([
      "timer ended",
      "timer mark cleared",
      "timer unbound",
      "sync reset",
      "restore point saved",
      "engine closed",
    ])
  })

  it("holds the next sign-in until the close finished", async () => {
    sessions.hold = true
    const out = unloadForSignOut()
    const next = openForUser({ id: 2, username: "b" })
    await vi.waitFor(() => expect(sessions.release).not.toBeNull())
    expect(calls).not.toContain("open 2")
    sessions.release!()
    await out
    await next
    expect(calls.indexOf("open 2")).toBeGreaterThan(calls.indexOf("engine closed"))
    expect(calls.slice(-2)).toEqual(["timer bound", "timer reconciled"])
  })
})
