"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ExercisePicker } from "@/components/exercises/ExercisePicker"
import { useAuth } from "@/components/auth/AuthProvider"
import { api } from "@/lib/api"
import type { Exercise } from "@/types"

export default function ExercisesPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <ExercisesPageInner />
    </Suspense>
  )
}

function ExercisesPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const pickForRaw = params.get("pickFor")
  const pickFor = pickForRaw ? Number(pickForRaw) : null
  const { user, loading } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  async function pick(ex: Exercise) {
    if (!pickFor) return
    setBusy(true)
    setError(null)
    try {
      const we = await api.addExerciseToWorkout(pickFor, ex.id)
      router.push(`/workouts/${pickFor}/exercises/${we.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add exercise")
      setBusy(false)
    }
  }

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-4">
      <h1 className="text-xl font-bold tracking-tight">
        {pickFor ? "Choose Exercise" : "Exercises"}
      </h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {busy && <p className="text-sm text-muted-foreground">Adding…</p>}
      <ExercisePicker
        mode={pickFor ? "pick" : "browse"}
        onPick={pickFor ? pick : undefined}
      />
    </div>
  )
}
