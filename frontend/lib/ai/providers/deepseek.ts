import type { AIProvider, GenerateOpts } from "../types"

export const deepseekProvider: AIProvider = {
  id: "deepseek",
  async generate({ systemPrompt, userPrompt, apiKey }: GenerateOpts): Promise<string> {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 400)}`)
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new Error("DeepSeek returned no content")
    return content
  },
}
