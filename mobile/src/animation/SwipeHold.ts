/**
 * Holds store commits back while a set row's swipe gesture is in flight.
 *
 * The legacy Swipeable tracks the finger on the UI thread, but the release
 * (the spring that settles the row open or closed) is dispatched from JS in
 * `handleRelease`. A delete commit and the full-screen re-render behind it
 * block JS for long enough that a release arriving inside that window leaves
 * the row parked wherever the finger let go, until JS is free again. So a
 * commit that lands while any row is being dragged waits until every row's
 * release has been dispatched, and then runs on the next frame: the native
 * spring call has flushed by then, so the heavy JS work no longer stalls it.
 *
 * Idle is the common case and stays synchronous: `run` executes the task in
 * place when no gesture is active, so the delete path behaves exactly as
 * before unless the user is mid-swipe.
 */
export class SwipeHold {
  private readonly active = new Set<number>()
  private queued: Array<() => void> = []
  private scheduled = false
  private disposed = false

  constructor(
    private readonly nextFrame: (fn: () => void) => void = (fn) => {
      requestAnimationFrame(fn)
    }
  ) {}

  /** True while at least one row's pan gesture is active. */
  get busy(): boolean {
    return this.active.size > 0
  }

  /** A row's pan gesture became active (onSwipeable*StartDrag). */
  begin(rowId: number): void {
    if (this.disposed) return
    this.active.add(rowId)
  }

  /** The row's release spring was dispatched (onSwipeableWill{Open,Close}). */
  end(rowId: number): void {
    if (!this.active.delete(rowId)) return
    if (!this.busy) this.schedule()
  }

  /** The rows unmounted: no release will arrive for gestures still open. */
  releaseAll(): void {
    this.active.clear()
    this.schedule()
  }

  /** Run now when idle, otherwise after the in-flight gestures settle. */
  run(task: () => void): void {
    if (this.busy && !this.disposed) {
      this.queued.push(task)
      return
    }
    task()
  }

  /** Run everything queued right now, e.g. before navigating away. */
  flush(): void {
    const tasks = this.queued.splice(0)
    for (const task of tasks) task()
  }

  activate(): void {
    this.disposed = false
  }

  /** Commit whatever is queued and stop holding; deletes must never be lost. */
  dispose(): void {
    this.disposed = true
    this.active.clear()
    this.flush()
  }

  private schedule(): void {
    if (this.scheduled || this.queued.length === 0) return
    this.scheduled = true
    this.nextFrame(() => {
      this.scheduled = false
      // A new drag started before the frame fired: its release reschedules.
      if (this.busy) return
      this.flush()
    })
  }
}
