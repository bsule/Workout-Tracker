"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ExercisePicker } from "@/components/exercises/ExercisePicker"
import { useAuth } from "@/components/auth/AuthProvider"
import { useConfirm } from "@/components/ui/ConfirmDialog"
import { FullPageLoader } from "@/components/ui/Spinner"
import { localApi as api } from "@/lib/store"
import type { Exercise } from "@/types"

export default function ExercisesPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <ExercisesPageInner />
    </Suspense>
  )
}

function ExercisesPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const pickForRaw = params.get("pickFor")
  const pickFor = pickForRaw ? Number(pickForRaw) : null
  const forDate = params.get("forDate")
  const isPickMode = Boolean(pickFor || forDate)
  const { user, loading } = useAuth()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  async function pick(ex: Exercise) {
    if (!isPickMode) return
    setBusy(true)
    setError(null)
    try {
      let workoutId = pickFor
      if (!workoutId && forDate) {
        const w = await api.createWorkout(forDate)
        if (w.merged_into_finished) {
          const ok = await confirm({
            title: "Already finished a workout today",
            message:
              "You have a finished session for this date. Continuing will add this exercise to that same session — there's no separate two-a-day yet.",
            confirmLabel: "Add to that session",
          })
          if (!ok) {
            setBusy(false)
            return
          }
        }
        workoutId = w.id
      }
      if (!workoutId) return
      const we = await api.addExerciseToWorkout(workoutId, ex.id)
      router.push(`/workouts/${workoutId}/exercises/${we.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add exercise")
      setBusy(false)
    }
  }

  if (loading || !user) {
    return <FullPageLoader />
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-4">
      <h1 className="text-xl font-bold tracking-tight">
        {isPickMode ? "Choose Exercise" : "Exercises"}
      </h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {busy && <p className="text-sm text-muted-foreground">Adding…</p>}
      <ExercisePicker
        mode={isPickMode ? "pick" : "browse"}
        onPick={isPickMode ? pick : undefined}
      />
    </div>
  )
}
