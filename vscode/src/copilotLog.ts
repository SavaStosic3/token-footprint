import { ZERO, addUsage, type TokenUsage } from '../../core/footprint.ts'
import type { Prompt, Usage } from '../../types'

// One model call read from Copilot Chat's OpenTelemetry file export.
export type Call = { trace: string; endMs: number; usage: TokenUsage }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Each line of the export is a span, a log record or a metrics batch, as JSON.
// Only `chat` spans count, one per model call: the `invoke_agent` span and the
// inference log event repeat the same tokens and would count them twice.
export function parseLine(line: string): Call | undefined {
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return undefined
  }
  const a = o?.attributes
  if (!a || a['gen_ai.operation.name'] !== 'chat' || typeof o.name !== 'string' || o.kind === undefined) return undefined
  // The response names the model that ran, which matters when the picker is on Auto.
  const model = a['gen_ai.response.model'] ?? a['gen_ai.request.model']
  if (typeof model !== 'string' || a['gen_ai.usage.input_tokens'] === undefined) return undefined
  const read = num(a['gen_ai.usage.cache_read.input_tokens'])
  const write = num(a['gen_ai.usage.cache_creation.input_tokens'])
  // Copilot's input_tokens is the whole prompt, cache reads and writes included.
  const fresh = Math.max(0, num(a['gen_ai.usage.input_tokens']) - read - write)
  // Older Copilot builds wrote the SDK's span object as-is, context under _spanContext.
  const trace = o.traceId ?? o._spanContext?.traceId ?? ''
  // Copilot's own charge, in nano AI credits: 1 credit is 1e9 nano and costs $0.01.
  // The agent host and the Copilot Chat extension name it differently.
  const nano = a['github.copilot.nano_aiu'] ?? a['copilot_chat.copilot_usage_nano_aiu']
  const end = Array.isArray(o.endTime) ? num(o.endTime[0]) * 1000 + num(o.endTime[1]) / 1e6 : Date.now()
  return {
    trace: String(trace),
    endMs: end,
    usage: {
      model,
      input_tokens: fresh,
      output_tokens: num(a['gen_ai.usage.output_tokens']),
      cache_read_input_tokens: read,
      cache_creation_input_tokens: write,
      ...(typeof nano === 'number' && Number.isFinite(nano) ? { usd: nano / 1e11 } : {}),
    },
  }
}

// The session so far. A prompt is one trace: everything Copilot did for one request.
// billed and estimated count the calls priced by Copilot's own charge and by API list prices.
export type Tally = { total: Usage; prompts: Prompt[]; trace?: string; recent: [endMs: number, wh: number][]; billed: number; estimated: number }
export const start = (): Tally => ({ total: ZERO, prompts: [], recent: [], billed: 0, estimated: 0 })

export function tally(t: Tally, c: Call): Tally {
  const fresh = c.trace !== t.trace || t.prompts.length === 0
  const last: Prompt = fresh ? { ...ZERO, label: '' } : t.prompts.at(-1)!
  const prompt = addUsage(last, c.usage)
  const total = addUsage(t.total, c.usage)
  return {
    total,
    prompts: [...(fresh ? t.prompts : t.prompts.slice(0, -1)), prompt].slice(-500),
    trace: c.trace,
    billed: t.billed + (c.usage.usd === undefined ? 0 : 1),
    estimated: t.estimated + (c.usage.usd === undefined ? 1 : 0),
    recent: [...t.recent.filter(([end]) => c.endMs - end < 60_000), [c.endMs, total.wh - t.total.wh] as [number, number]],
  }
}

// Where the cost total comes from, for the card.
export const costNote = (t: Tally) =>
  t.billed && t.estimated ? 'Copilot credits + API price' : t.billed ? 'charged in Copilot credits' : 'at API list price'

// Wh burned in the minute before `now`.
export const whLastMinute = (t: Tally, now: number) => t.recent.filter(([end]) => now - end < 60_000).reduce((s, [, wh]) => s + wh, 0)
