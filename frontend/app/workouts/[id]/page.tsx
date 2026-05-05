"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, Trash2, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChartToggle } from "@/components/workouts/ChartToggle"
import { WorkoutHistoryTable } from "@/components/workouts/WorkoutHistoryTable"
import { WorkoutLogForm } from "@/components/workouts/WorkoutLogForm"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { useAuth } from "@/components/auth/AuthProvider"
import { ApiError, api } from "@/lib/api"
import type { WorkoutSplit } from "@/types"

export default function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const workoutId = Number(id)
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [workout, setWorkout] = useState<WorkoutSplit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace("/login")
      return
    }
    api
      .getWorkout(workoutId)
      .then(setWorkout)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load workout.")
      )
  }, [authLoading, user, workoutId, router])

  async function refresh() {
    setWorkout(await api.getWorkout(workoutId))
  }

  async function handleAddSet(weight: number, reps: number) {
    if (!workout) return
    setBusy(true)
    try {
      const sessions = workout.sessions ?? []
      let sessionId = sessions[sessions.length - 1]?.id
      if (!sessionId) {
        const session = await api.createSession(workout.id)
        sessionId = session.id
      }
      await api.addSet(sessionId, { weight, reps })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to log set.")
    } finally {
      setBusy(false)
    }
  }

  async function handleNextDay() {
    if (!workout) return
    setBusy(true)
    try {
      await api.createSession(workout.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start a new day.")
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || workout === null) {
    return (
      <PageWrapper>
        <div className="mx-auto max-w-3xl px-4 py-10">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </PageWrapper>
    )
  }

  const sessions = workout.sessions ?? []
  const bestSession = sessions.length
    ? sessions.reduce((best, s) => (s.max_weight > best.max_weight ? s : best))
    : null

  const chartData = sessions.slice(-7).map((s) => ({
    date: new Date(s.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    maxWeight: Math.round(s.max_weight * 10) / 10,
  }))

  return (
    <PageWrapper>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link
          href="/workouts"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          All workouts
        </Link>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {workout.name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} logged
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/workouts/${workout.id}/delete-day`}>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
              >
                <Trash2 className="size-3.5" />
                Delete Day
              </Button>
            </Link>
            <Button size="sm" className="gap-1.5" onClick={handleNextDay} disabled={busy}>
              Next Day
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        <WorkoutLogForm onSubmit={handleAddSet} />

        {chartData.length > 0 && (
          <div className="mt-5">
            <ChartToggle data={chartData} />
          </div>
        )}

        <div className="mt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Session History
          </h2>
          <WorkoutHistoryTable
            sessions={sessions}
            bestSessionId={bestSession?.id ?? -1}
          />
        </div>
      </div>
    </PageWrapper>
  )
}
