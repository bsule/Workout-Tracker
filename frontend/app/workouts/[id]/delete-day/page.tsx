"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { TriangleAlert } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { ApiError, api } from "@/lib/api"
import { formatDate } from "@/lib/utils"
import type { WorkoutSplit } from "@/types"

export default function DeleteDayPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const workoutId = Number(params.id)
  const [workout, setWorkout] = useState<WorkoutSplit | null>(null)
  const [selected, setSelected] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .getWorkout(workoutId)
      .then(setWorkout)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load workout.")
      )
  }, [workoutId])

  const sessions = workout?.sessions ?? []
  const selectedSession = sessions.find((s) => String(s.id) === selected)

  async function handleDelete() {
    if (!selected) return
    setBusy(true)
    try {
      await api.deleteSession(Number(selected))
      router.push(`/workouts/${workoutId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete session.")
    } finally {
      setBusy(false)
    }
  }

  if (!workout) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted-foreground">
          {error ?? "Loading…"}
        </p>
      </div>
    )
  }

  return (
    <PageWrapper>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-destructive/20 bg-card p-6 shadow-2xl">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <TriangleAlert className="size-5 text-destructive" />
              </div>
              <div>
                <h1 className="font-semibold text-foreground">Delete Session</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Removing a session from{" "}
                  <span className="font-medium text-foreground">{workout.name}</span>
                </p>
              </div>
            </div>

            {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Select session to delete
                </p>
                <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
                  <SelectTrigger className="w-full h-10">
                    <SelectValue placeholder="Choose a session…" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...sessions]
                      .sort(
                        (a, b) =>
                          new Date(b.date).getTime() - new Date(a.date).getTime()
                      )
                      .map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {formatDate(s.date)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="destructive"
                        className="w-full h-10 font-semibold bg-destructive/15 text-destructive hover:bg-destructive/25 border border-destructive/30"
                        disabled={!selected || busy}
                      />
                    }
                  >
                    Delete Session
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia>
                        <TriangleAlert className="size-5 text-destructive" />
                      </AlertDialogMedia>
                      <AlertDialogTitle>Delete this session?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove the session from{" "}
                        <strong className="text-foreground">
                          {selectedSession ? formatDate(selectedSession.date) : ""}
                        </strong>
                        . This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive/15 text-destructive hover:bg-destructive/25 border border-destructive/30"
                        onClick={handleDelete}
                      >
                        Yes, delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Link href={`/workouts/${params.id}`} className="block">
                  <Button variant="ghost" className="w-full h-10">
                    Cancel
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  )
}
