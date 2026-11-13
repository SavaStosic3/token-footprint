import type { TokenUsage } from '../../core/footprint.ts'

// The fields of the Copilot runtime's `assistant.usage` event this canvas reads.
export type UsageData = {
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  copilotUsage?: { totalNanoAiu: number }
}

// One model call, in the shape the shared estimates take.
export function usageOf(d: UsageData): TokenUsage {
  const read = d.cacheReadTokens ?? 0
  const write = d.cacheWriteTokens ?? 0
  const nano = d.copilotUsage?.totalNanoAiu
  return {
    model: d.model,
    // The runtime's input count is the whole prompt, cache reads and writes included.
    input_tokens: Math.max(0, (d.inputTokens ?? 0) - read - write),
    output_tokens: d.outputTokens ?? 0,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
    // Copilot's own charge, in nano AI credits: 1 credit is 1e9 nano and costs $0.01.
    ...(typeof nano === 'number' && Number.isFinite(nano) ? { usd: nano / 1e11 } : {}),
  }
}
