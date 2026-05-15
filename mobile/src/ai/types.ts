import type { AIProviderId, Category, ExerciseKind } from "@lift/core"

export type { AIProviderId }

export interface AIProviderMeta {
  id: AIProviderId
  label: string
}

export const AI_PROVIDERS: AIProviderMeta[] = [
  { id: "openai", label: "OpenAI (ChatGPT)" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "gemini", label: "Google Gemini" },
  { id: "deepseek", label: "DeepSeek" },
]

export interface GenerateOpts {
  systemPrompt: string
  userPrompt: string
  apiKey: string
}

export interface AIProvider {
  id: AIProviderId
  generate(opts: GenerateOpts): Promise<string>
}

// ----- AI request/response payload shapes ------------------------------

export interface HistoryDay {
  date: string
  exercises: HistoryExercise[]
}

export interface HistoryExercise {
  name: string
  category: Category
  kind: ExerciseKind
  sets: HistorySet[]
}

export interface HistorySet {
  weight?: number | null
  reps?: number | null
  distance_m?: number | null
  time_seconds?: number | null
}

export interface AiPlanSet {
  weight?: number | null
  reps?: number | null
  distance_m?: number | null
  time_seconds?: number | null
  note?: string
}

export interface AiPlanExercise {
  name: string
  category?: Category
  kind?: ExerciseKind
  sets: AiPlanSet[]
}

export interface AiPlanDay {
  date: string
  exercises: AiPlanExercise[]
}

export interface AiPlanResponse {
  days: AiPlanDay[]
}
