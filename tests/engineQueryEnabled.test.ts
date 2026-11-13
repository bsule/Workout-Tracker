import { expect, it, vi } from "vitest"
const hooks = vi.hoisted(() => ({ stop: () => {} }))
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (subscribe: (fn: () => void) => () => void, snapshot: () => unknown) => {
    hooks.stop = subscribe(() => {})
    return snapshot()
  },
}))
import { useEngineQuery } from "../packages/engine-client/src/react"
import { EngineClient } from "../packages/engine-client/src/index"

it("does no history work until enabled, while preserving covered-screen preloading", async () => {
  const query = vi.fn(async () => ({ generation: 1, revision: 0, data: { total: 0, items: [] } }))
  const client = new EngineClient({ query, execute: vi.fn(), close: async () => {} }, 1)
  const onReturn = vi.fn(() => () => {})
  const history = { kind: "history_all", exercise_id: 1 }
  useEngineQuery(client, "history:1", history, { enabled: false, active: false, onReturn })
  expect(query).not.toHaveBeenCalled()
  expect(onReturn).not.toHaveBeenCalled()
  hooks.stop()
  useEngineQuery(client, "history:1", history, { enabled: true, active: false, onReturn })
  await vi.waitFor(() => expect(client.snapshot("history:1", history).status).toBe("ready"))
  expect(query).toHaveBeenCalledOnce()
  expect(onReturn).toHaveBeenCalledOnce()
  hooks.stop()
  useEngineQuery(client, "history:1", history, { active: true })
  expect(query).toHaveBeenCalledOnce()
  hooks.stop()
  await client.close()
})
