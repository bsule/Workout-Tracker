export interface WorkoutSet {
  weight: number
  reps: number
}

export interface WorkoutSession {
  id: number
  date: string       // ISO string
  sets: WorkoutSet[]
  maxWeight: number  // estimated one-rep max for this session
}

export interface WorkoutSplit {
  id: number
  name: string
  sessions: WorkoutSession[]
}
