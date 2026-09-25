// The AI planning layer lives in @lift/core, shared with mobile. API keys stay
// here (./keys, localStorage).
import { createProviderLookup } from "@lift/core/ai"

export * from "@lift/core/ai"

// A browser calling the Anthropic API directly has to opt in to CORS, so the
// web lookup sends the direct-browser-access header. Mobile does not.
export const getProvider = createProviderLookup({ anthropic: { directBrowserAccess: true } })
