"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ExercisePicker } from "@/components/exercises/ExercisePicker"
import { useAuth } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"
import { getWorkoutQ } from "@/lib/store"
import { pendingLoggerHref } from "@/lib/loggerHref"
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
  const [error, setError] = useState<string | null>(null)
  const [pickerView, setPickerView] = useState<"list" | "new">("list")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  // Straight to the set logger for that day. Nothing is created here: the
  // logger creates the workout and the exercise row on the first saved set,
  // so backing out of it leaves no empty workout behind.
  function pick(ex: Exercise) {
    if (!isPickMode) return
    setError(null)
    const date = pickFor ? getWorkoutQ(pickFor)?.date ?? null : forDate
    if (!date) {
      setError("Workout not found")
      return
    }
    router.replace(pendingLoggerHref(date, ex.id))
  }

  if (loading || !user) {
    return <FullPageLoader />
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-4">
      {/* The picker's "New Exercise" form carries its own heading. */}
      {pickerView === "list" && (
        <h1 className="text-xl font-bold tracking-tight">
          {isPickMode ? "Choose Exercise" : "Exercises"}
        </h1>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ExercisePicker
        mode={isPickMode ? "pick" : "browse"}
        onPick={isPickMode ? pick : undefined}
        onViewChange={setPickerView}
      />
    </div>
  )
}
