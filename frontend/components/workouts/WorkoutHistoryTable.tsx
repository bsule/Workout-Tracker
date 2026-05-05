import { Trophy } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { WorkoutSession } from "@/types"

export function WorkoutHistoryTable({
  sessions,
  bestSessionId,
}: {
  sessions: WorkoutSession[]
  bestSessionId: number
}) {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No sessions yet. Log a set above to get started.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {sorted.map((session) => {
        const isPR = session.id === bestSessionId
        return (
          <div
            key={session.id}
            className={`rounded-xl border bg-card overflow-hidden ${
              isPR ? "border-primary/30" : "border-white/8"
            }`}
          >
            {/* Session header */}
            <div
              className={`flex items-center justify-between border-b px-4 py-2.5 ${
                isPR ? "border-primary/20 bg-primary/8" : "border-white/8"
              }`}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {formatDate(session.date)}
              </p>
              {isPR && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  <Trophy className="size-3" />
                  PR
                </span>
              )}
            </div>

            {/* Sets table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Set
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Weight
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Reps
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Est. 1RM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(session.sets ?? []).map((set, i) => {
                    const est1rm =
                      set.reps === 1
                        ? set.weight
                        : set.weight / (1.0278 - 0.0278 * set.reps)
                    return (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {set.weight} lbs
                        </td>
                        <td className="px-4 py-2.5 text-foreground">{set.reps}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {Math.round(est1rm)} lbs
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Session 1RM */}
            <div className="border-t border-white/5 px-4 py-2 flex justify-end">
              <span className="text-xs text-muted-foreground">
                Session 1RM:{" "}
                <span className="font-bold text-foreground">
                  {Math.round(session.max_weight)} lbs
                </span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
