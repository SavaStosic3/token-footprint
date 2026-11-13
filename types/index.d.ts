export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  wh: number
  // USD at the model's published API list price; 0 for models without one.
  usd: number
}

export type Prompt = Usage & { label: string }

// Streamed output not yet settled by a step's real usage, and the faucet's flow.
export type Live = { pendingWh: number; mlPerMin: number }

declare module 'claude-code' {
  interface PluginState {
    'token-footprint': { total: Usage; prompts: Prompt[]; live: Live }
  }
}
