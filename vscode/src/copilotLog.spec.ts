import assert from 'node:assert/strict'
import { test } from 'node:test'

import { costNote, parseLine, start, tally, whLastMinute } from './copilotLog.ts'

// Lines shaped like Copilot Chat's file export (extensions/copilot/src/platform/otel/node/fileExporters.ts).
const span = (name: string, attributes: object, trace = 't1', session = 'win-1') =>
  JSON.stringify({
    traceId: trace,
    spanId: Math.random().toString(16).slice(2),
    name,
    kind: 2,
    startTime: [1763049600, 0],
    endTime: [1763049601, 500_000_000],
    attributes,
    resource: { attributes: { 'service.name': 'copilot-chat', 'session.id': session } },
  })
const chat = (model: string, input: number, output: number, read = 0, write = 0, trace = 't1', session = 'win-1') =>
  span(
    `chat ${model}`,
    {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': model,
      'gen_ai.response.model': model,
      'gen_ai.usage.input_tokens': input,
      'gen_ai.usage.output_tokens': output,
      ...(read ? { 'gen_ai.usage.cache_read.input_tokens': read } : {}),
      ...(write ? { 'gen_ai.usage.cache_creation.input_tokens': write } : {}),
    },
    trace,
    session,
  )

test('a chat span becomes one model call, cache tokens split out of the input', () => {
  const call = parseLine(chat('claude-opus-5.5', 100_000, 2_000, 90_000, 6_000))
  assert.deepEqual(call?.usage, {
    model: 'claude-opus-5.5',
    input_tokens: 4_000,
    output_tokens: 2_000,
    cache_read_input_tokens: 90_000,
    cache_creation_input_tokens: 6_000,
  })
  assert.equal(call?.endMs, 1763049601500)
})

test('the agent host’s chat span parses too (recorded from VS Code 1.146)', () => {
  const line = JSON.stringify({
    traceId: 'a1',
    spanId: 'b2',
    parentSpanId: 'c3',
    name: 'chat mai-code-1.1-flash',
    kind: 2,
    type: 'span',
    endTime: [1794592490, 0],
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'github',
      'gen_ai.request.model': 'mai-code-1.1-flash',
      'gen_ai.response.model': 'mai-code-1.1-flash',
      'gen_ai.usage.input_tokens': 5905,
      'gen_ai.usage.output_tokens': 6,
      'gen_ai.usage.cache_read.input_tokens': 5504,
      'github.copilot.cost': 1,
    },
    resource: { attributes: { 'service.name': 'github-copilot', 'service.namespace': 'vscode.agent-host' } },
  })
  assert.deepEqual(parseLine(line)?.usage, {
    model: 'mai-code-1.1-flash',
    input_tokens: 401,
    output_tokens: 6,
    cache_read_input_tokens: 5504,
    cache_creation_input_tokens: 0,
  })
})

test('Copilot’s own charge replaces the API-price estimate when it is logged', () => {
  // As recorded: 19,748,000 nano credits = 0.019748 credits at $0.01 = $0.00019748.
  const agentHost = JSON.parse(chat('claude-opus-5.5', 100_000, 2_000, 90_000, 6_000, 'p1'))
  agentHost.attributes['github.copilot.nano_aiu'] = 19_748_000
  const billed = parseLine(JSON.stringify(agentHost))!
  assert.equal(billed.usage.usd, 0.00019748)
  // The Copilot Chat extension's own spans name it copilot_chat.copilot_usage_nano_aiu.
  const extension = JSON.parse(chat('gpt-6.1-sol', 1_000, 1_000, 0, 0, 'p2'))
  extension.attributes['copilot_chat.copilot_usage_nano_aiu'] = 3_000_000_000
  const billedToo = parseLine(JSON.stringify(extension))!
  assert.equal(billedToo.usage.usd, 0.03)

  let t = tally(start(), billed)
  assert.equal(t.total.usd, 0.00019748)
  assert.equal(costNote(t), 'charged in Copilot credits')
  t = tally(t, billedToo)
  assert.equal(Math.round(t.total.usd * 1e8), 3_019_748)
  // A call with no charge logged falls back to API list prices: 1k in at $1, 1k out at $5.
  t = tally(t, parseLine(chat('gpt-6.1-terra', 1_000, 1_000, 0, 0, 'p3'))!)
  assert.equal(Math.round(t.total.usd * 1e8), 3_019_748 + 600_000)
  assert.equal(costNote(t), 'Copilot credits + API price')
  assert.equal(costNote(tally(start(), parseLine(chat('gpt-6.1-terra', 1, 1))!)), 'at API list price')
})

test('spans, logs and metrics that repeat the tokens are skipped', () => {
  const agent = span('invoke_agent copilot', { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.usage.input_tokens': 5 })
  const log = JSON.stringify({ attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 5, 'gen_ai.request.model': 'x' } })
  const metrics = JSON.stringify({ resource: {}, scopeMetrics: [] })
  for (const line of [agent, log, metrics, '', 'not json', 'null']) assert.equal(parseLine(line), undefined)
})

test('older Copilot builds that wrote the raw span still parse', () => {
  const old = JSON.stringify({
    _spanContext: { traceId: 'old', spanId: 's' },
    name: 'chat gpt-6.1-terra',
    kind: 2,
    attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': 'gpt-6.1-terra', 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 1 },
    resource: { _attributes: { 'session.id': 'win-1' } },
  })
  assert.equal(parseLine(old)?.trace, 'old')
})

test('calls add up per prompt and per session, priced by the model Copilot ran', () => {
  let t = start()
  // Prompt 1 on Opus 5.5: 4k fresh at $4, 2k out at $20, 90k cache reads at $0.20, 6k writes at $5 per 1M.
  t = tally(t, parseLine(chat('claude-opus-5.5', 100_000, 2_000, 90_000, 6_000, 'p1'))!)
  // Same prompt, a second call on Sonnet 5.5 with no cache: 1k in at $2, 1k out at $10.
  t = tally(t, parseLine(chat('claude-sonnet-5.5', 1_000, 1_000, 0, 0, 'p1'))!)
  // Prompt 2 on GPT-6.1 Sol: 1k in at $2, 1k out at $10.
  t = tally(t, parseLine(chat('gpt-6.1-sol', 1_000, 1_000, 0, 0, 'p2'))!)
  assert.equal(t.prompts.length, 2)
  assert.equal(Math.round(t.prompts[0]!.usd * 1e6), 16_000 + 40_000 + 18_000 + 30_000 + 2_000 + 10_000)
  assert.equal(Math.round(t.prompts[1]!.usd * 1e6), 12_000)
  assert.equal(Math.round(t.total.usd * 1e6), 128_000)
  assert.equal(t.total.cacheRead, 90_000)
  assert.ok(t.total.wh > 0)
  assert.ok(Math.abs(whLastMinute(t, 1763049601500 + 1000) - t.total.wh) < 1e-9)
  assert.equal(whLastMinute(t, 1763049601500 + 61_000), 0)
})

test('every model in the picker has a price', () => {
  for (const model of ['claude-opus-5.5', 'claude-sonnet-5.5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gemini-4-argon', 'gemini-4-carbon']) {
    const t = tally(start(), parseLine(chat(model, 1_000, 1_000))!)
    assert.ok(t.total.usd > 0, model)
  }
})
