export interface WorkoutSet {
  id: number
  weight: number
  reps: number
}

export interface WorkoutSession {
  id: number
  date: string
  sets: WorkoutSet[]
  max_weight: number
}

export interface WorkoutSplit {
  id: number
  name: string
  created_at: string
  sessions: WorkoutSession[]
}

export interface User {
  id: number
  username: string
  email: string
}

export interface AuthResponse {
  token: string
  user: User
}
