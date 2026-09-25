"use client"

import Link from "next/link"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { useAuth } from "@/components/auth/AuthProvider"
import { NewExerciseForm } from "@/components/exercises/NewExerciseForm"
import { FullPageLoader } from "@/components/ui/Spinner"
import { pendingLoggerHref } from "@/lib/loggerHref"
import { getWorkoutQ } from "@/lib/store"
import type { Exercise } from "@/types"

export default function NewExercisePage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <NewExercisePageInner />
    </Suspense>
  )
}

/**
 * The web copy of mobile's NewExerciseScreen. Opened for a day (`forDate`) or
 * a workout (`pickFor`), it goes on to the set logger for the new exercise on
 * that day, which creates the workout on the first saved set. Otherwise it
 * returns to the exercise list.
 */
function NewExercisePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const pickForRaw = params.get("pickFor")
  const pickFor = pickForRaw ? Number(pickForRaw) : null
  const forDate = params.get("forDate")
  const { user, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  function onCreated(ex: Exercise) {
    if (pickFor || forDate) {
      const date = pickFor ? getWorkoutQ(pickFor)?.date ?? null : forDate
      if (!date) {
        setError("Workout not found")
        return
      }
      router.replace(pendingLoggerHref(date, ex.id))
      return
    }
    router.replace("/exercises")
  }

  if (loading || !user) return <FullPageLoader />

  const query = pickFor ? `?pickFor=${pickFor}` : forDate ? `?forDate=${forDate}` : ""

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-6 sm:py-10">
      <Link
        href={`/exercises${query}`}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" />
        Exercises
      </Link>

      <h1 className="text-xl font-bold tracking-tight">New exercise</h1>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <NewExerciseForm submitLabel="Create" onCreated={onCreated} />
    </div>
  )
}
