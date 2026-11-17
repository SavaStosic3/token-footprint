import { expect, mock, test } from 'claude-code/testing'

import { CARBON, ENERGY, WATER, addUsage, co2, gauge, ml, view } from '../core/footprint'
import { pack } from './register'

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wh: 0, usd: 0 }
const usage = (model: string) => ({
  model,
  input_tokens: 1000,
  output_tokens: 1000,
  cache_read_input_tokens: 10000,
  cache_creation_input_tokens: 0,
})
const PANE_PROPS = {
  title: 'Footprint',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('energy scales with tokens and model size', async () => {
  const sonnet = addUsage(ZERO, usage('claude-sonnet-4-5'))
  // 1000 * 0.0001 + 1000 * 0.0005 + 10000 * 0.00001 = 0.7 Wh
  expect(Math.round(sonnet.wh * 1000)).toBe(700)
  expect(addUsage(sonnet, usage('claude-sonnet-4-5')).cacheRead).toBe(20000)
  expect(addUsage(ZERO, usage('claude-haiku-4-5')).wh).toBeLessThan(sonnet.wh)
  expect(addUsage(ZERO, usage('claude-opus-5-5')).wh).toBeGreaterThan(sonnet.wh)
  // Other providers' models are sized small, mid or large too. "gemini" must not read as "-mini".
  const wh = (model: string) => addUsage(ZERO, usage(model)).wh
  expect(wh('mai-code-1.1-flash')).toBe(wh('claude-haiku-4-5'))
  expect(wh('gpt-6.1-terra')).toBe(sonnet.wh)
  expect(wh('gemini-3.8-flash')).toBe(sonnet.wh)
  expect(wh('gpt-6.1-sol')).toBe(wh('claude-opus-5-5'))
  expect(wh('gemini-4-argon')).toBe(wh('claude-opus-5-5'))
  expect(wh('some-unknown-model')).toBe(wh('claude-opus-5-5'))
  expect(wh('claude-fable-5-2')).toBeGreaterThan(wh('claude-opus-5-5'))
  expect(Math.round(ml(1) * 10)).toBe(42)
  expect(co2(1)).toBe(0.35)
})

test('cost follows each model\'s published price', async () => {
  // In millionths of a dollar, so the arithmetic is exact.
  const micro = (u: ReturnType<typeof usage>, sum = ZERO) => Math.round(addUsage(sum, u).usd * 1e6)
  // 1000 input, 1000 output, 10000 cache-read tokens at each model's $ per 1M.
  expect(micro(usage('claude-sonnet-5-5'))).toBe(2000 + 10000 + 1000)
  expect(micro(usage('claude-opus-5-5'))).toBe(4000 + 20000 + 2000)
  expect(micro(usage('gpt-6.1-terra'))).toBe(1000 + 5000 + 500)
  // Past 272K prompt tokens GPT-6.1 Sol bills the whole request at its long-context rate.
  expect(micro({ ...usage('gpt-6.1-sol'), input_tokens: 300000 })).toBe(300000 * 4 + 15000 + 2000)
  expect(micro(usage('gemini-4-argon'))).toBeGreaterThan(0)
  expect(micro(usage('gemini-5-carbon'))).toBe(micro(usage('gemini-4-argon')))
  // Version-less ids are their own models: Opus 5 is not Opus 5.5, nor Sonnet 5 Sonnet 5.5.
  expect(micro(usage('claude-opus-5'))).toBe(5000 + 25000 + 5000)
  expect(micro(usage('claude-sonnet-5'))).toBe(2000 + 10000 + 2000)
  expect(micro(usage('claude-fable-5-2'))).toBe(8000 + 40000 + 2000)
  // Haiku 5.5 switches to its long-prompt price past 100K prompt tokens, not 272K.
  expect(micro(usage('claude-haiku-5-5'))).toBe(100 + 500 + 100)
  expect(micro({ ...usage('claude-haiku-5-5'), input_tokens: 100000 })).toBe(100000 * 0.5 + 2500 + 500)
  expect(micro(usage('gpt-6-luna'))).toBe(100 + 500 + 100)
  expect(micro(usage('mai-code-1.1-flash'))).toBe(200 + 1200 + 200)
  // No published price on file: no cost, and the call is counted as unpriced so the pane can say so.
  expect(micro(usage('claude-haiku-4-5'))).toBe(0)
  expect(addUsage(ZERO, usage('claude-haiku-4-5')).unpriced).toBe(1)
  expect(addUsage(ZERO, usage('claude-sonnet-5-5')).unpriced).toBe(undefined)
  expect(addUsage(ZERO, { ...usage('claude-haiku-4-5'), usd: 0.5 }).unpriced).toBe(undefined)
  // A total saved before cost existed still adds up.
  const { usd: _, ...old } = ZERO
  expect(micro(usage('claude-sonnet-5-5'), old as typeof ZERO)).toBe(13000)
  // A charge the host reports replaces the estimate.
  expect(micro({ ...usage('claude-opus-5-5'), usd: 0.5 })).toBe(500000)
  // Copilot spells versions with dots.
  expect(micro(usage('claude-opus-5.5'))).toBe(micro(usage('claude-opus-5-5')))
  // Dollars to the cent, with a USD suffix.
  expect(view(0, 0, 0, 5.214, 0.0042).text.cost).toBe('cost   $5.21 USD')
  expect(view(0, 0, 0, 5.214, 0.0042).text.costSub).toBe('this prompt $0.00 USD')
})

test('gauge names the milestone reached and fills toward the next', async () => {
  expect(gauge(100, WATER)).toMatchObject({ many: 'shot glasses', fill: 0.4 })
  expect(gauge(0.01, ENERGY)).toMatchObject({ many: 'web searches', fill: 0.01 / 0.3 })
  expect(gauge(1e9, ENERGY)).toMatchObject({ many: 'US home-days', fill: 1, next: undefined })
  // CO2 climbs in driving distances: 300 g is past 1 km, on the way to 10 km.
  expect(gauge(300, CARBON).next?.[2]).toBe('10 km of driving')
  expect(view(1000, 0, 0, 0, 0).text.carbonSub).toBe('≈ 1.4 km of driving')
})

test('pack fills each line up to the width, then starts another', async () => {
  const parts = ['aaaa', 'bbbb', 'cccc'].map(text => [{ text }])
  const lines = (width: number) => pack(parts, width).map(line => line.map(s => s.text).join(''))
  expect(lines(11)).toEqual(['aaaa · bbbb', 'cccc'])
  expect(lines(100)).toEqual(['aaaa · bbbb · cccc'])
  expect(lines(4)).toEqual(['aaaa', 'bbbb', 'cccc'])
})

test('a short pane above the prompt still shows all four numbers', async $ => {
  const inline = (bodyColumns: number, bodyRows: number) =>
    $.ui.mount({
      plugin: 'token-footprint',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'token-footprint',
      props: { ...PANE_PROPS, placement: 'inline' as const, bodyColumns, scroll: { offset: 0, bodyRows } },
    })
  for (const [columns, rows] of [[60, 3], [40, 2], [120, 1]] as const) {
    const ui = await inline(columns, rows)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toMatch(/water/)
    expect(drawn).toMatch(/energy/)
    expect(drawn).toMatch(/CO2/)
    expect(drawn).toMatch(/cost/)
    expect(drawn).not.toMatch(/█/)
    await ui.unmount()
  }
})

test('the usage rate reads idle when nothing streams', async () => {
  expect(view(1, 1, 0, 0, 0).text.rate).toBe('usage rate  idle')
  expect(view(1, 1, 12.6, 0, 0).text.rate).toBe('usage rate  12.6 mL/min')
})

test('a model step lands in the prompt and the pane draws it on both surfaces', async ($, on) => {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text' as const, index: 0, text: 'hello world' }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'hello world',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: usage('claude-sonnet-5-5'),
    }
  })
  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  const chunks = []
  for await (const chunk of step) chunks.push(chunk)
  expect(chunks).toHaveLength(1)
  await step.result

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'token-footprint', surface, component: 'Pane', requestId: 'token-footprint', props: PANE_PROPS })
    // The terminal draws text; the desktop draws cards whose alt text carries the same lines.
    const drawn = JSON.stringify(await ui.drawn())
    // 0.7 Wh -> 2.9 mL: past a drop, on the way to a teaspoon; ~0.25 g CO2, about a metre of driving.
    expect(drawn).toMatch(/this prompt +2\.9 mL · 700 mWh · 0\.2[45] g CO2/)
    expect(drawn).toMatch(/≈ 59 drops/)
    expect(drawn).toMatch(/next: teaspoon 59%/)
    expect(drawn).toMatch(/≈ 1 m of driving/)
    // Sonnet 5.5 at list price: $0.013, shown to the cent.
    expect(drawn).toMatch(/this prompt \$0\.01 USD/)
    // Emoji widths differ between terminals and shift every cell drawn after one.
    if (surface === 'terminal') expect(/\p{Extended_Pictographic}/u.test(drawn)).toBe(false)
    else expect(drawn).toMatch(/<svg/)
    await ui.unmount()
  }
})

test('the project total carries over from earlier sessions and grows with this one', async ($, on) => {
  const root = '/work/shop'
  on('session.root', () => ({ value: root }))
  // An earlier session in this project left 10 Wh and $1.50 behind.
  mock.store(on, { [`project:${root}`]: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wh: 10, usd: 1.5 } })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text' as const, index: 0, text: 'hi' }
    return { turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage: usage('claude-sonnet-5-5') }
  })
  await $.turn.start({ text: 'go', turnId: 't1' })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })
  for await (const _ of step) {
  }
  await step.result

  // 10 Wh + this step's 0.7 Wh, and $1.50 + $0.013. The pane draws what was written back to the store.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'token-footprint', surface, component: 'Pane', requestId: 'token-footprint', props: PANE_PROPS })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toMatch(/project +44\.9 mL · 10\.7 Wh · 3\.7[45] g CO2 · \$1\.51 USD/)
    if (surface === 'desktop') expect(drawn).toMatch(/PROJECT TOTAL/)
    await ui.unmount()
  }
})
