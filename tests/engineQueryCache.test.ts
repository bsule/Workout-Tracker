import { describe, expect, it, vi } from "vitest"
import {
  EngineClient,
  HISTORY_PAGE_DAYS,
  isQueryAffected,
  type EngineTransport,
  type QueryReply,
} from "../packages/engine-client/src/index"

// The hooks are thin over useSyncExternalStore. Swap React's hooks for direct
// calls so a test can drive subscribe/getSnapshot the way React does,
// including StrictMode's subscribe, unsubscribe, subscribe on mount.
let lastStore: { subscribe: (l: () => void) => () => void; getSnapshot: () => unknown } | null = null
vi.mock("react", () => ({
  createContext: () => ({ Provider: () => null }),
  createElement: () => null,
  useContext: () => null,
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useSyncExternalStore: (subscribe: (l: () => void) => () => void, getSnapshot: () => unknown) => {
    lastStore = { subscribe, getSnapshot }
    return getSnapshot()
  },
}))
const { useEngineQuery, queryValue } = await import("../packages/engine-client/src/react")

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function fakeTransport(data: (q: any) => unknown = (q) => q.kind) {
  let revision = 1
  const reads: any[] = []
  const pending: Array<() => void> = []
  let hold = false
  const transport: EngineTransport = {
    query: (q: any) => {
      reads.push(q)
      const reply = () => ({ generation: 1, revision, data: data(q) })
      if (!hold) return Promise.resolve(reply())
      return new Promise<QueryReply<unknown>>((resolve) => pending.push(() => resolve(reply())))
    },
    execute: async (id) => {
      revision++
      return { command_id: id, generation: 1, revision, result: null }
    },
    close: async () => {},
  }
  return {
    transport,
    reads,
    hold: (on: boolean) => { hold = on },
    release: () => { while (pending.length) pending.shift()!() },
  }
}

describe("isQueryAffected", () => {
  it("refreshes the calendar when an exercise changes category or is deleted", () => {
    const calendar = { kind: "calendar", month: "2026-01" }
    expect(isQueryAffected(calendar, { op: "patch_exercise", id: 3, patch: { category: "legs" } })).toBe(true)
    expect(isQueryAffected(calendar, { op: "delete_exercise", id: 3 })).toBe(true)
    expect(isQueryAffected({ kind: "planned_dates", month: "2026-01" }, { op: "delete_exercise", id: 3 })).toBe(true)
    expect(isQueryAffected(calendar, { op: "update_settings", patch: {} })).toBe(false)
  })

  it("treats the whole-history read like a history page", () => {
    expect(isQueryAffected({ kind: "history_all", exercise_id: 1 }, { op: "set_exercise_note", we_id: 1, text: "" })).toBe(true)
    expect(isQueryAffected({ kind: "history_all", exercise_id: 1 }, { op: "add_set", we_id: 1, input: {} })).toBe(true)
  })
})

describe("EngineClient retained results", () => {
  it("keeps a result after the last unsubscribe and shows it at once on return", async () => {
    const t = fakeTransport()
    const client = new EngineClient(t.transport, 1, 1)
    const q = { kind: "counts" }
    const stop = client.subscribe("counts", q, () => {})
    await flush()
    stop()
    expect(client.snapshot("counts", q)).toMatchObject({ status: "ready", value: "counts" })
    // Still current: no read on resubscribe.
    const reads = t.reads.length
    client.subscribe("counts", q, () => {})
    await flush()
    expect(t.reads.length).toBe(reads)
    await client.close()
  })

  it("does not refetch idle results on commits, and catches up on resubscribe", async () => {
    const t = fakeTransport()
    const client = new EngineClient(t.transport, 1, 1)
    const q = { kind: "workout_by_date", date: "2026-01-01" }
    const stop = client.subscribe("day", q, () => {})
    await flush()
    stop()
    const before = t.reads.length
    await client.execute("c1", { op: "add_set", we_id: 1, input: {} }, "now", "today")
    await flush()
    expect(t.reads.length).toBe(before)
    client.subscribe("day", q, () => {})
    await flush()
    expect(t.reads.length).toBe(before + 1)
    expect(client.snapshot("day", q)).toMatchObject({ status: "ready", revision: 2 })
    await client.close()
  })

  it("prefetch reads a stale entry without subscribing", async () => {
    const t = fakeTransport()
    const client = new EngineClient(t.transport, 1, 1)
    const q = { kind: "gyms" }
    await client.prefetch("gyms", q)
    expect(client.snapshot("gyms", q)).toMatchObject({ status: "ready", value: "gyms" })
    await client.prefetch("gyms", q)
    expect(t.reads.length).toBe(1)
    await client.close()
  })

  it("reads a whole history across pages from one revision", async () => {
    const days = Array.from({ length: HISTORY_PAGE_DAYS + 30 }, (_, i) => ({ date: String(i) }))
    const t = fakeTransport((q) => ({ total: days.length, items: days.slice(q.offset, q.offset + q.limit) }))
    const client = new EngineClient(t.transport, 1, 1)
    const all = await client.query<{ total: number; items: unknown[] }>({ kind: "history_all", exercise_id: 7 })
    expect(all.items).toHaveLength(days.length)
    expect(t.reads.map((r) => r.offset)).toEqual([0, HISTORY_PAGE_DAYS])
    await client.close()
  })
})

describe("useEngineQuery", () => {
  it("StrictMode double subscribe shows no loading flash and keeps one result", async () => {
    const t = fakeTransport()
    const client = new EngineClient(t.transport, 1, 1)
    const q = { kind: "settings" }
    useEngineQuery(client, "settings", q)
    const store = lastStore!
    const listener = vi.fn()
    const first = store.subscribe(listener)
    first()
    store.subscribe(listener)
    await flush()
    expect(store.getSnapshot()).toMatchObject({ status: "ready", value: "settings" })
    expect(listener).toHaveBeenCalled()
    await client.close()
  })

  it("drops a read that lands after unmount, and the next mount reads again", async () => {
    const t = fakeTransport()
    const client = new EngineClient(t.transport, 1, 1)
    const q = { kind: "day_note", date: "2026-01-01" }
    t.hold(true)
    useEngineQuery(client, "note", q)
    const listener = vi.fn()
    const stop = lastStore!.subscribe(listener)
    stop()
    t.release()
    await flush()
    expect(listener).not.toHaveBeenCalled()
    t.hold(false)
    useEngineQuery(client, "note", q)
    lastStore!.subscribe(listener)
    await flush()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(lastStore!.getSnapshot()).toMatchObject({ status: "ready" })
    await client.close()
  })

  it("a key change reads the new key and leaves the old one retained", async () => {
    const t = fakeTransport((q) => q.date)
    const client = new EngineClient(t.transport, 1, 1)
    const a = { kind: "workout_by_date", date: "a" }
    const b = { kind: "workout_by_date", date: "b" }
    useEngineQuery(client, "w:a", a)
    const stopA = lastStore!.subscribe(() => {})
    await flush()
    stopA()
    useEngineQuery(client, "w:b", b)
    lastStore!.subscribe(() => {})
    await flush()
    expect(lastStore!.getSnapshot()).toMatchObject({ status: "ready", value: "b" })
    expect(client.snapshot("w:a", a)).toMatchObject({ status: "ready", value: "a" })
    await client.close()
  })

  it("an inactive (covered) screen does not refetch on commits, reads once if empty, and catches up on return", async () => {
    const t = fakeTransport()
    const client = new EngineClient(t.transport, 1, 1)
    const q = { kind: "calendar", month: "2026-01" }
    let fireReturn = () => {}
    const onReturn = (l: () => void) => { fireReturn = l; return () => {} }
    useEngineQuery(client, "cal", q, { active: false, onReturn })
    const listener = vi.fn()
    lastStore!.subscribe(listener)
    await flush()
    expect(t.reads.length).toBe(1)
    await client.execute("c1", { op: "add_set", we_id: 1, input: {} }, "now", "today")
    await flush()
    expect(t.reads.length).toBe(1)
    fireReturn()
    await flush()
    expect(t.reads.length).toBe(2)
    expect(lastStore!.getSnapshot()).toMatchObject({ status: "ready", revision: 2 })
    await client.close()
  })

  it("queryValue throws a failed read instead of returning the fallback", () => {
    expect(queryValue({ status: "loading" }, [])).toEqual([])
    expect(queryValue({ status: "ready", value: 3, revision: 1 }, 0)).toBe(3)
    expect(() => queryValue({ status: "error", error: new Error("disk") }, [])).toThrow("disk")
  })
})
