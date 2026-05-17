import type { AIProvider, GenerateOpts } from "../types"

export const geminiProvider: AIProvider = {
  id: "gemini",
  async generate({ systemPrompt, userPrompt, apiKey }: GenerateOpts): Promise<string> {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      encodeURIComponent(apiKey)
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      if (res.status === 429) {
        throw new Error(
          "Gemini rate-limited (429). Your free-tier quota for this model is exhausted — wait a minute and retry, or check quotas at aistudio.google.com.",
        )
      }
      if (res.status === 403) {
        throw new Error(
          "Gemini 403: the Generative Language API may not be enabled on this project, or the key is invalid.",
        )
      }
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 400)}`)
    }
    const json = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] }
      }[]
    }
    const text = json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
    if (!text) throw new Error("Gemini returned no text content")
    return text
  },
}
