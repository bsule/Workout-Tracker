"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Modal } from "@/components/ui/Modal"

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
  opts: ConfirmOptions
}

const DEFAULT_OPTS: ConfirmOptions = { title: "Are you sure?" }

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = useState<InternalState>({
    open: false,
    opts: DEFAULT_OPTS,
  })
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setState({ open: true, opts })
    })
  }, [])

  function close(result: boolean) {
    resolveRef.current?.(result)
    resolveRef.current = null
    setState((s) => ({ ...s, open: false }))
  }

  return (
    <ConfirmContext value={confirm}>
      {children}

      <Modal open={state.open} onClose={() => close(false)} title={state.opts.title} className="overflow-hidden p-0" initialFocus={cancelRef}>
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
        <div className="mt-5 flex justify-end gap-2 border-t border-foreground/5 bg-foreground/[.02] px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => close(false)}
            ref={cancelRef}
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
      </Modal>
    </ConfirmContext>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx)
    throw new Error("useConfirm must be used within ConfirmDialogProvider")
  return ctx
}
