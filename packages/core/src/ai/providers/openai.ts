import type { AIProvider, GenerateOpts } from "../types"

export const openaiProvider: AIProvider = {
  id: "openai",
  async generate({ systemPrompt, userPrompt, apiKey }: GenerateOpts): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`)
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error("OpenAI returned no content")
    return content
  },
}
