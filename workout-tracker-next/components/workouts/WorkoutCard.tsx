import Link from "next/link"
import { CalendarDays, ChevronRight, Trophy } from "lucide-react"
import { formatDateShort } from "@/lib/utils"
import type { WorkoutSplit } from "@/types"

export function WorkoutCard({ workout }: { workout: WorkoutSplit }) {
  const lastSession = workout.sessions[workout.sessions.length - 1]
  const bestMax = Math.max(...workout.sessions.map((s) => s.maxWeight))

  return (
    <Link href={`/workouts/${workout.id}`} className="group block">
      <div className="rounded-xl border border-white/8 bg-card p-5 transition-all duration-200 hover:border-white/15 hover:shadow-xl hover:shadow-primary/8 hover:scale-[1.01]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="mb-0.5 truncate font-semibold text-foreground group-hover:text-primary transition-colors">
              {workout.name}
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5" />
                {workout.sessions.length} session{workout.sessions.length !== 1 ? "s" : ""}
              </span>
              {lastSession && (
                <span className="text-xs text-muted-foreground">
                  Last: {formatDateShort(lastSession.date)}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 mt-1 transition-transform group-hover:translate-x-0.5" />
        </div>

        {/* PR display */}
        <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary/8 px-3 py-2">
          <Trophy className="size-3.5 text-primary shrink-0" />
          <span className="text-xs text-muted-foreground">Best 1RM:</span>
          <span className="ml-auto text-xs font-bold text-primary tabular-nums">
            {Math.round(bestMax)} lbs
          </span>
        </div>
      </div>
    </Link>
  )
}
