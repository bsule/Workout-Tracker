import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowRight, Trash2, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChartToggle } from "@/components/workouts/ChartToggle"
import { WorkoutHistoryTable } from "@/components/workouts/WorkoutHistoryTable"
import { WorkoutLogForm } from "@/components/workouts/WorkoutLogForm"
import { PageWrapper } from "@/components/layout/PageWrapper"
import { getWorkoutById, getChartData } from "@/lib/mock-data"

export default async function WorkoutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workout = getWorkoutById(Number(id))

  if (!workout) notFound()

  const chartData = getChartData(Number(id))
  const bestSession = workout.sessions.reduce((best, s) =>
    s.maxWeight > best.maxWeight ? s : best
  )

  return (
    <PageWrapper>
      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Back link */}
        <Link
          href="/workouts"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          All workouts
        </Link>

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {workout.name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {workout.sessions.length} session{workout.sessions.length !== 1 ? "s" : ""} logged
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
            <Button size="sm" className="gap-1.5">
              Next Day
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Log form */}
        <WorkoutLogForm onSubmit={(w, r) => console.log({ w, r })} />

        {/* Chart */}
        <div className="mt-5">
          <ChartToggle data={chartData} />
        </div>

        {/* History */}
        <div className="mt-8">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Session History
          </h2>
          <WorkoutHistoryTable
            sessions={workout.sessions}
            bestSessionId={bestSession.id}
          />
        </div>
      </div>
    </PageWrapper>
  )
}
