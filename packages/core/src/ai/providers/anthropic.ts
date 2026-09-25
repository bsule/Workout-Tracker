import type { AIProvider, GenerateOpts } from "../types"

export interface AnthropicProviderOptions {
  /**
   * Send `anthropic-dangerous-direct-browser-access: true`. A browser calling
   * the API straight from the page with the user's own key needs this header
   * for CORS; the web app sets it. React Native has no CORS, so mobile leaves
   * it off and its requests stay as they were.
   */
  directBrowserAccess?: boolean
}

export function createAnthropicProvider(opts: AnthropicProviderOptions = {}): AIProvider {
  return {
    id: "anthropic",
    async generate({ systemPrompt, userPrompt, apiKey }: GenerateOpts): Promise<string> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(opts.directBrowserAccess
            ? { "anthropic-dangerous-direct-browser-access": "true" }
            : {}),
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Anthropic ${res.status}: ${text.slice(0, 400)}`)
      }
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[]
      }
      const text = json.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("")
      if (!text) throw new Error("Anthropic returned no text content")
      return text
    },
  }
}

/** The provider without the browser header (mobile's requests). */
export const anthropicProvider: AIProvider = createAnthropicProvider()
