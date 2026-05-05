"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/api"
import { DayView } from "@/components/workouts/DayView"
import { useAuth } from "@/components/auth/AuthProvider"

export default function WorkoutByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { user, loading } = useAuth()
  const [date, setDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  useEffect(() => {
    if (!user) return
    api
      .getWorkout(Number(id))
      .then((w) => {
        setDate(w.date)
        router.replace(`/workouts/date/${w.date}`)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Not found"))
  }, [id, user, router])

  if (error)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-destructive">
        {error}
      </div>
    )
  if (!date)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <DayView date={date} />
    </div>
  )
}
