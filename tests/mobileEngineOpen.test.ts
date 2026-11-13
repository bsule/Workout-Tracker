/**
 * Opening a mobile account's engine (mobile/src/engine/openEngine.ts): the
 * legacy `users/<username>` store moves first and a failed move rejects the
 * load before the engine opens; the legacy etag and the one install id go
 * into the open; per-process session ids never repeat a receipt's command id.
 */
import { describe, expect, it, vi } from "vitest"
import { createEngineOpener, withCommitHook, type OpenEngineDeps } from "../mobile/src/engine/openEngine"
import { AccountSessions } from "../packages/engine-client/src/session"

function deps(overrides: Partial<OpenEngineDeps> = {}) {
  const events: string[] = []
  const d: OpenEngineDeps = {
    adoptLegacyStore: vi.fn(async (from: string, to: string) => {
      events.push(`adopt ${from} -> ${to}`)
      return true
    }),
    accountDirUri: (sub) => `file:///docs/lift/${sub.replace(/[^a-zA-Z0-9_-]/g, "_")}/`,
    deviceId: vi.fn(async () => "install-1234"),
    legacyEtag: vi.fn(async () => "legacy-etag"),
    open: vi.fn(async (session, path, device, now, legacy) => {
      events.push(`open ${session} ${path} ${device} ${now} ${legacy.etag}`)
      return {
        transport: {
          query: async () => ({ generation: 1, revision: 0, data: null }),
          execute: async (id: string) => ({ command_id: id, generation: 1, revision: 1, result: null }),
          close: async () => {},
        },
        generation: 1,
        revision: 0,
      }
    }),
    now: () => "2026-09-21T08:00:00.000Z",
    ...overrides,
  }
  return { d, events }
}

describe("openEngine", () => {
  it("moves the legacy store, then opens the id path with the legacy etag and install id", async () => {
    const { d, events } = deps()
    await createEngineOpener(d)("42", "mobile:a:1", { username: "tester" })
    expect(events).toEqual([
      "adopt users/tester -> accounts/42",
      "open mobile:a:1 file:///docs/lift/accounts_42/engine.sqlite install-1234 2026-09-21T08:00:00.000Z legacy-etag",
    ])
  })

  it("rejects the load, and never opens, when the move fails", async () => {
    const { d } = deps({ adoptLegacyStore: vi.fn(async () => { throw new Error("disk full") }) })
    await expect(createEngineOpener(d)("42", "s", { username: "tester" })).rejects.toThrow("disk full")
    expect(d.open).not.toHaveBeenCalled()
  })

  it("opens an account with no legacy store (fresh install, no username)", async () => {
    const { d } = deps({ legacyEtag: vi.fn(async () => null) })
    await createEngineOpener(d)("7", "s", { username: "" })
    expect(d.adoptLegacyStore).not.toHaveBeenCalled()
    expect(vi.mocked(d.open).mock.calls[0][4]).toEqual({ etag: null })
  })

  it("refuses an account key that is not a user id", async () => {
    const { d } = deps()
    await expect(createEngineOpener(d)("users/x", "s", { username: "x" })).rejects.toThrow("Invalid account")
    expect(d.open).not.toHaveBeenCalled()
  })

  it("passes each switch's username to its own open", async () => {
    const seen: string[] = []
    const sessions = new AccountSessions<{ username: string }>(async (key, _id, context) => {
      seen.push(`${key}:${context.username}`)
      return { transport: { query: async () => ({ generation: 1, revision: 0, data: null }), execute: async () => { throw Error("unused") }, close: async () => {} }, generation: 1, revision: 0 }
    }, "mobile")
    void sessions.switchAccount("1", { username: "first" })
    await sessions.switchAccount("2", { username: "second" })
    expect(seen).toEqual(["2:second"])
  })

  it("never reuses a session id across instances (a relaunch)", async () => {
    const ids: string[] = []
    const open = async (_key: string, id: string) => {
      ids.push(id)
      return { transport: { query: async () => ({ generation: 1, revision: 0, data: null }), execute: async () => { throw Error("unused") }, close: async () => {} }, generation: 1, revision: 0 }
    }
    await new AccountSessions(open, "mobile").switchAccount("1")
    await new AccountSessions(open, "mobile").switchAccount("1")
    expect(ids[0]).not.toBe(ids[1])
  })

  it("reports accepted writes, not reads or failures", async () => {
    const commits = vi.fn()
    let fail = false
    const opened = withCommitHook({
      transport: {
        query: async () => ({ generation: 1, revision: 0, data: null }),
        execute: async (id: string) => { if (fail) throw Error("refused"); return { command_id: id, generation: 1, revision: 1, result: null } },
        close: async () => {},
      },
      generation: 1,
      revision: 0,
    }, commits)
    await opened.transport.query({ kind: "counts" })
    await opened.transport.execute("a", 1, {}, "now", "today")
    fail = true
    await expect(opened.transport.execute("b", 1, {}, "now", "today")).rejects.toThrow("refused")
    expect(commits).toHaveBeenCalledOnce()
  })
})
