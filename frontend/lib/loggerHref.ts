/**
 * Where to log sets for `exerciseId` on `date`, before the workout or its
 * exercise row exists. The page shows the set logger and creates both on the
 * first saved set (mobile's `pendingCreate`), so backing out creates nothing.
 * If the exercise is already on that day's workout, the page redirects to it.
 */
export function pendingLoggerHref(date: string, exerciseId: number): string {
  return `/workouts/date/${date}/log/${exerciseId}`
}

/** The set logger for an existing workout exercise row. */
export function loggerHref(workoutId: number, weId: number): string {
  return `/workouts/${workoutId}/exercises/${weId}`
}
