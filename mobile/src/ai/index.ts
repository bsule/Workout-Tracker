import type { AIProvider, AIProviderId } from "./types"
import { anthropicProvider } from "./providers/anthropic"
import { deepseekProvider } from "./providers/deepseek"
import { geminiProvider } from "./providers/gemini"
import { openaiProvider } from "./providers/openai"

const PROVIDERS: Record<AIProviderId, AIProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  deepseek: deepseekProvider,
}

export function getProvider(id: AIProviderId): AIProvider {
  return PROVIDERS[id]
}

export { AI_PROVIDERS } from "./types"
export type { AIProvider, AIProviderId, AiPlanResponse, AiPlanDay, AiPlanExercise, AiPlanSet } from "./types"
