"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface InternalState {
  open: boolean
  // mounted state — separates entering/leaving from controlling visibility
  mounted: boolean
  opts: ConfirmOptions
  resolve?: (v: boolean) => void
}

const DEFAULT_OPTS: ConfirmOptions = { title: "Are you sure?" }

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = useState<InternalState>({
    open: false,
    mounted: false,
    opts: DEFAULT_OPTS,
  })
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setState({ open: false, mounted: true, opts })
      // mount first, then flip open on next frame for the enter animation
      requestAnimationFrame(() => {
        setState((s) => ({ ...s, open: true }))
      })
    })
  }, [])

  function close(result: boolean) {
    resolveRef.current?.(result)
    resolveRef.current = null
    setState((s) => ({ ...s, open: false }))
    // unmount after exit animation
    setTimeout(() => {
      setState((s) => ({ ...s, mounted: false }))
    }, 180)
  }

  // ESC to cancel
  useEffect(() => {
    if (!state.open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false)
      if (e.key === "Enter") close(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state.open])

  return (
    <ConfirmContext value={confirm}>
      {children}

      {state.mounted && (
        <div
          className={cn(
            "fixed inset-0 z-[100] flex items-center justify-center px-4 transition-opacity duration-150",
            state.open
              ? "bg-black/60 backdrop-blur-sm opacity-100"
              : "bg-black/60 backdrop-blur-sm opacity-0"
          )}
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
          aria-label={state.opts.title}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-card text-foreground shadow-2xl",
              "transition-all duration-150 ease-out",
              state.open
                ? "opacity-100 scale-100 translate-y-0"
                : "opacity-0 scale-95 translate-y-2 pointer-events-none"
            )}
          >
            <div className="flex items-start gap-3 px-5 pt-5">
              {state.opts.destructive ? (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <AlertTriangle className="size-5" />
                </span>
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <AlertTriangle className="size-5" />
                </span>
              )}
              <div className="flex-1 pt-0.5">
                <h2 className="text-base font-semibold tracking-tight">
                  {state.opts.title}
                </h2>
                {state.opts.message && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {state.opts.message}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-white/5 bg-white/[.02] px-4 py-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => close(false)}
                autoFocus
              >
                {state.opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                type="button"
                size="lg"
                onClick={() => close(true)}
                className={cn(
                  state.opts.destructive
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : ""
                )}
              >
                {state.opts.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx)
    throw new Error("useConfirm must be used within ConfirmDialogProvider")
  return ctx
}
