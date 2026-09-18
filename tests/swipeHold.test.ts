import { describe, expect, it, vi } from "vitest"
import { SwipeHold } from "../mobile/src/animation/SwipeHold"

// A manual frame scheduler: tests decide when the "next frame" runs.
function frames() {
  const pending: Array<() => void> = []
  const hold = new SwipeHold((fn) => { pending.push(fn) })
  const tick = () => { for (const fn of pending.splice(0)) fn() }
  return { hold, tick, pending }
}

describe("SwipeHold", () => {
  it("runs a commit at once when no swipe is in flight", () => {
    const { hold, pending } = frames()
    const commit = vi.fn()
    hold.run(commit)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(pending).toHaveLength(0)
  })

  it("holds a commit while a row is being dragged", () => {
    const { hold, tick } = frames()
    const commit = vi.fn()
    hold.begin(7)
    hold.run(commit)
    expect(commit).not.toHaveBeenCalled()
    tick()
    expect(commit).not.toHaveBeenCalled()
  })

  it("runs the held commit one frame after the release is dispatched", () => {
    const { hold, tick, pending } = frames()
    const commit = vi.fn()
    hold.begin(7)
    hold.run(commit)
    hold.end(7)
    // Same JS turn as the release: the native spring call has not flushed.
    expect(commit).not.toHaveBeenCalled()
    expect(pending).toHaveLength(1)
    tick()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("keeps holding while any of several rows is still dragged", () => {
    const { hold, tick } = frames()
    const commit = vi.fn()
    hold.begin(1)
    hold.begin(2)
    hold.run(commit)
    hold.end(1)
    tick()
    expect(commit).not.toHaveBeenCalled()
    hold.end(2)
    tick()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("waits again when a new drag starts before the frame fires", () => {
    const { hold, tick } = frames()
    const commit = vi.fn()
    hold.begin(1)
    hold.run(commit)
    hold.end(1)
    hold.begin(2)
    tick()
    expect(commit).not.toHaveBeenCalled()
    hold.end(2)
    tick()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("runs queued commits in order, once each", () => {
    const { hold, tick } = frames()
    const calls: number[] = []
    hold.begin(1)
    hold.run(() => calls.push(1))
    hold.run(() => calls.push(2))
    hold.end(1)
    tick()
    tick()
    expect(calls).toEqual([1, 2])
  })

  it("ignores a release for a row that never began", () => {
    const { hold, pending } = frames()
    hold.end(99)
    expect(pending).toHaveLength(0)
    expect(hold.busy).toBe(false)
  })

  it("releaseAll drops in-flight rows and schedules the queue", () => {
    const { hold, tick } = frames()
    const commit = vi.fn()
    hold.begin(1)
    hold.run(commit)
    hold.releaseAll()
    expect(hold.busy).toBe(false)
    tick()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("flush runs queued commits now, without waiting for a frame", () => {
    const { hold, pending } = frames()
    const commit = vi.fn()
    hold.begin(1)
    hold.run(commit)
    hold.flush()
    expect(commit).toHaveBeenCalledTimes(1)
    for (const fn of pending.splice(0)) fn()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("dispose flushes the queue and makes later commits immediate", () => {
    const { hold } = frames()
    const queued = vi.fn()
    const later = vi.fn()
    hold.begin(1)
    hold.run(queued)
    hold.dispose()
    expect(queued).toHaveBeenCalledTimes(1)
    hold.begin(2)
    hold.run(later)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it("activate re-arms a disposed hold", () => {
    const { hold, tick } = frames()
    hold.dispose()
    hold.activate()
    const commit = vi.fn()
    hold.begin(1)
    hold.run(commit)
    expect(commit).not.toHaveBeenCalled()
    hold.end(1)
    tick()
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
