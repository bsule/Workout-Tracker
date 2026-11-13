/**
 * Opening one account's engine, with every platform piece injected so the
 * order is testable: move an older build's `users/<username>` store to the
 * id path first, exactly once, and refuse the load when that move fails.
 * Nothing may create the account folder before the move, or the move would
 * see a target and skip, stranding the user's data under the old path.
 */
import { accountStorePath, legacyStorePath } from "@lift/core/store/paths"
import type { OpenedEngine } from "@lift/engine-client/session"

export interface OpenContext {
  /** Locates a store an older build kept under the username. */
  username: string
}

export interface OpenEngineDeps {
  adoptLegacyStore(fromSubPath: string, toSubPath: string): Promise<boolean>
  accountDirUri(subPath: string): string
  deviceId(): Promise<string>
  /** The etag the legacy JS transport saved, carried into a first migration. */
  legacyEtag(): Promise<string | null>
  open(
    sessionId: string,
    path: string,
    deviceId: string,
    now: string,
    legacy: { etag: string | null }
  ): Promise<OpenedEngine>
  now(): string
}

export function createEngineOpener(deps: OpenEngineDeps) {
  return async (accountKey: string, sessionId: string, context?: OpenContext): Promise<OpenedEngine> => {
    const userId = Number(accountKey)
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid account.")
    const subPath = accountStorePath(userId)
    // Throws on failure, which rejects the load: an empty account must never
    // stand in for data the move could not reach.
    if (context?.username) await deps.adoptLegacyStore(legacyStorePath(context.username), subPath)
    const [deviceId, etag] = await Promise.all([deps.deviceId(), deps.legacyEtag()])
    const path = deps.accountDirUri(subPath) + "engine.sqlite"
    return deps.open(sessionId, path, deviceId, deps.now(), { etag })
  }
}

/** Tells commit listeners about each accepted write; reads pass through. */
export function withCommitHook(opened: OpenedEngine, onCommit: () => void): OpenedEngine {
  const { transport, data } = opened
  return {
    ...opened,
    transport: {
      ...transport,
      query: (query) => transport.query(query),
      close: () => transport.close(),
      execute: async (...args) => {
        const receipt = await transport.execute(...args)
        onCommit()
        return receipt
      },
    },
    data: data && {
      ...data,
      importFile: async (request) => {
        const receipt = await data.importFile(request)
        onCommit()
        return receipt
      },
      replaceSnapshot: async (...args) => {
        const receipt = await data.replaceSnapshot(...args)
        onCommit()
        return receipt
      },
    },
  }
}
