export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  wh: number
  // USD: what the host charged when it reports that, else the model's published API list price.
  usd: number
  // Model calls counted in usd as nothing, having neither a charge nor a list price.
  unpriced?: number
}

export type Prompt = Usage & { label: string }

// Streamed output not yet settled by a step's real usage, and the faucet's flow.
export type Live = { pendingWh: number; mlPerMin: number }

declare module 'claude-code' {
  interface PluginState {
    // project is the running total of every session in this session's project root, kept in $.store.
    'token-footprint': { total: Usage; prompts: Prompt[]; live: Live; project: Usage }
  }
}
