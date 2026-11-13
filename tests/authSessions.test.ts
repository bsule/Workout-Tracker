import { beforeEach, expect, it, vi } from "vitest"

// Execute the providers' actual effects and event handlers with controlled
// hook storage; no native runtime or DOM is needed to order HTTP responses.
const h = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | void)[], states: [] as unknown[],
  token: "A" as string | null, cached: { id: 1, username: "a" } as unknown,
  me: vi.fn(), logout: vi.fn(), sync: vi.fn(),
}))
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
  useEffect: (fn: () => (() => void) | void) => { h.effects.push(fn) },
  useState: (initial: unknown) => {
    const index = h.states.length
    const value = typeof initial === "function" ? initial() : initial
    h.states.push(value)
    return [value, (next: unknown) => { h.states[index] = next }]
  },
}))
vi.mock("@/lib/api", () => ({
  api: { me: h.me, logout: h.logout, login: async () => ({ token: "B", user: { id: 2, username: "b" } }) },
  getToken: () => h.token, getCachedUser: () => h.cached,
  setToken: (token: string | null) => { h.token = token },
  setCachedUser: (user: unknown) => { h.cached = user },
  ApiError: class extends Error { status = 401 },
}))
vi.mock("../mobile/src/auth/api", () => ({
  api: { me: h.me, logout: h.logout, login: async () => ({ token: "B", user: { id: 2, username: "b" } }) },
  getToken: async () => h.token, getCachedUser: async () => h.cached,
  setToken: async (token: string | null) => { h.token = token },
  setCachedUser: async (user: unknown) => { h.cached = user },
  ApiError: class extends Error { status = 401 },
}))
vi.mock("@lift/core", () => ({
  CloudflareTransport: class { setEtag() {} },
  configureSyncClock: () => {}, clearSyncClock: () => {}, createDeviceIdSource: () => () => "device",
  sync: { configureSync: h.sync },
}))
vi.mock("@lift/core/sync/syncClock", () => ({ configureSyncClock: () => {}, clearSyncClock: () => {} }))
vi.mock("@/lib/syncStorage", () => ({ readStoredEtag: () => null, writeStoredEtag: () => {}, webSyncClockStore: {}, webDeviceIdStore: {} }))
vi.mock("@/lib/store/session", () => ({ unloadWebStore: async () => {} }))
vi.mock("@/lib/restTimerMark", () => ({ clearMark: () => {} }))
vi.mock("../mobile/src/sync/engineSync", () => ({ configureEngineSync: h.sync }))
vi.mock("../mobile/src/sync/clockStore", () => ({ rnSyncClockStore: {} }))
vi.mock("../mobile/src/sync/deviceId", () => ({ clearLegacyEtag: () => {} }))

import { AuthProvider as Mobile } from "../mobile/src/auth/AuthProvider"
import { AuthProvider as Web } from "../frontend/components/auth/AuthProvider"
import { ApiError as MobileError } from "../mobile/src/auth/api"
import { ApiError as WebError } from "@/lib/api"

beforeEach(() => {
  h.effects = []; h.states = []; h.token = "A"; h.cached = { id: 1, username: "a" }
  vi.clearAllMocks(); h.logout.mockResolvedValue(undefined)
})
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

for (const [name, Provider, ErrorType] of [["mobile", Mobile, MobileError], ["web", Web, WebError]] as const) {
  it.each(["success", "401"])(`${name}: ignores a late initial profile %s after logout/login`, async outcome => {
    let resolve!: (value: unknown) => void
    let reject!: (error: Error) => void
    h.me.mockReturnValue(new Promise((a, b) => { resolve = a; reject = b }))
    const tree = Provider({ children: null }) as { props: { value: { login: (...args: never[]) => Promise<void>; logout: () => Promise<void> } } }
    h.effects[0]()
    await tick()
    expect(h.me).toHaveBeenCalledOnce()
    await tree.props.value.logout()
    const login = tree.props.value.login as (...args: unknown[]) => Promise<void>
    await (name === "mobile" ? login("b", "password") : login({ username: "b", password: "password" }))
    if (outcome === "success") resolve({ id: 1, username: "a" })
    else reject(new ErrorType(401, "revoked", null))
    await tick()
    expect(h.states[0]).toEqual({ id: 2, username: "b" })
    expect(h.states[1]).toBe(false)
    expect(h.cached).toEqual({ id: 2, username: "b" })
    expect(h.token).toBe("B")
  })
}
