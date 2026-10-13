export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  wh: number
}

export type Prompt = Usage & { label: string }

// Streamed output not yet settled by a step's real usage, and the faucet's flow.
export type Live = { pendingWh: number; mlPerMin: number }

declare module 'claude-code' {
  interface PluginState {
    'token-footprint': { total: Usage; prompts: Prompt[]; live: Live }
  }
}
