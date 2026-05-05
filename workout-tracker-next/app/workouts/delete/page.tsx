"use client"

import Link from "next/link"
import { useState } from "react"
import { TriangleAlert } from "lucide-react"
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
import { mockWorkouts } from "@/lib/mock-data"

export default function DeleteWorkoutPage() {
  const [selected, setSelected] = useState<string>("")
  const selectedWorkout = mockWorkouts.find((w) => String(w.id) === selected)

  function handleDelete() {
    // Backend not connected yet
    console.log("delete", selected)
  }

  return (
    <PageWrapper>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-destructive/20 bg-card p-6 shadow-2xl">
            {/* Warning header */}
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <TriangleAlert className="size-5 text-destructive" />
              </div>
              <div>
                <h1 className="font-semibold text-foreground">Delete Workout</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This will permanently remove all sessions for this routine.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Select workout to delete
                </p>
                <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
                  <SelectTrigger className="w-full h-10">
                    <SelectValue placeholder="Choose a workout…" />
                  </SelectTrigger>
                  <SelectContent>
                    {mockWorkouts.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
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
                        disabled={!selected}
                      />
                    }
                  >
                    Delete Workout
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia>
                        <TriangleAlert className="size-5 text-destructive" />
                      </AlertDialogMedia>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete{" "}
                        <strong className="text-foreground">
                          {selectedWorkout?.name}
                        </strong>{" "}
                        and all its logged sessions. This cannot be undone.
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

                <Link href="/workouts" className="block">
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
