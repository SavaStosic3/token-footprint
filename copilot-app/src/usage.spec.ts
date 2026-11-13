import assert from 'node:assert/strict'
import { test } from 'node:test'

import { usageOf } from './usage.ts'

test('a usage event becomes one model call, with Copilot’s charge in dollars', () => {
  assert.deepEqual(
    usageOf({ model: 'claude-opus-5.5', inputTokens: 100_000, outputTokens: 2_000, cacheReadTokens: 90_000, cacheWriteTokens: 6_000, copilotUsage: { totalNanoAiu: 19_748_000 } }),
    { model: 'claude-opus-5.5', input_tokens: 4_000, output_tokens: 2_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 6_000, usd: 0.00019748 },
  )
})

test('missing counts are zero, and a missing charge leaves the API-price estimate', () => {
  assert.deepEqual(usageOf({ model: 'gpt-6.1-terra' }), {
    model: 'gpt-6.1-terra',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  })
})
