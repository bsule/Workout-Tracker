// AI planning shared by both clients: prompts, history context, response
// parsing, applying a plan to the store, and the provider calls. API key
// storage is per platform and stays in each client (mobile: secure store,
// web: localStorage).

import type { AIProvider, AIProviderId, AiPlanSet } from "./types"
import { createAnthropicProvider, type AnthropicProviderOptions } from "./providers/anthropic"
import { deepseekProvider } from "./providers/deepseek"
import { geminiProvider } from "./providers/gemini"
import { openaiProvider } from "./providers/openai"

export interface ProviderOptions {
  anthropic?: AnthropicProviderOptions
}

/** A provider lookup configured for one platform. The web app turns on the
 *  Anthropic browser header here; mobile uses the default `getProvider`. */
export function createProviderLookup(opts: ProviderOptions = {}): (id: AIProviderId) => AIProvider {
  const providers: Record<AIProviderId, AIProvider> = {
    openai: openaiProvider,
    anthropic: createAnthropicProvider(opts.anthropic),
    gemini: geminiProvider,
    deepseek: deepseekProvider,
  }
  return (id) => providers[id]
}

export const getProvider: (id: AIProviderId) => AIProvider = createProviderLookup()

/** One planned set in the preview list: "100kg×5", "×12", "400m / 90s". */
export function formatPlanSet(
  s: Pick<AiPlanSet, "weight" | "reps" | "distance_m" | "time_seconds">,
  unit: string
): string {
  if (s.weight != null && s.reps != null) return `${s.weight}${unit}×${s.reps}`
  if (s.reps != null) return `×${s.reps}`
  if (s.distance_m != null && s.time_seconds != null)
    return `${s.distance_m}m / ${s.time_seconds}s`
  if (s.distance_m != null) return `${s.distance_m}m`
  if (s.time_seconds != null) return `${s.time_seconds}s`
  return "set"
}

export { AI_PROVIDERS } from "./types"
export type {
  AIProvider,
  AIProviderId,
  AIProviderMeta,
  GenerateOpts,
  AiPlanResponse,
  AiPlanDay,
  AiPlanExercise,
  AiPlanSet,
  HistoryDay,
  HistoryExercise,
  HistorySet,
} from "./types"
export { createAnthropicProvider, anthropicProvider } from "./providers/anthropic"
export type { AnthropicProviderOptions } from "./providers/anthropic"
export { openaiProvider } from "./providers/openai"
export { geminiProvider } from "./providers/gemini"
export { deepseekProvider } from "./providers/deepseek"
export { parseAiPlanResponse } from "./parse"
export { SYSTEM_PROMPT, buildUserPrompt } from "./prompts"
export { buildHistoryContext } from "./buildContext"
export { applyPlan } from "./applyPlan"
export type { ApplyResult } from "./applyPlan"
