import { expect, test } from 'claude-code/testing'

import { CARBON, ENERGY, WATER, addUsage, co2, gauge, ml, pack, view } from './register'

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wh: 0 }
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
  expect(Math.round(ml(1) * 10)).toBe(42)
  expect(co2(1)).toBe(0.35)
})

test('gauge names the milestone reached and fills toward the next', async () => {
  expect(gauge(100, WATER)).toMatchObject({ many: 'shot glasses', fill: 0.4 })
  expect(gauge(0.01, ENERGY)).toMatchObject({ many: 'web searches', fill: 0.01 / 0.3 })
  expect(gauge(1e9, ENERGY)).toMatchObject({ many: 'US home-days', fill: 1, next: undefined })
  // CO2 climbs in driving distances: 300 g is past 1 km, on the way to 10 km.
  expect(gauge(300, CARBON).next?.[2]).toBe('10 km of driving')
  expect(view(1000, 0, 0).text.carbonSub).toBe('≈ 1.4 km of driving')
})

test('pack fills each line up to the width, then starts another', async () => {
  const parts = ['aaaa', 'bbbb', 'cccc'].map(text => [{ text }])
  const lines = (width: number) => pack(parts, width).map(line => line.map(s => s.text).join(''))
  expect(lines(11)).toEqual(['aaaa · bbbb', 'cccc'])
  expect(lines(100)).toEqual(['aaaa · bbbb · cccc'])
  expect(lines(4)).toEqual(['aaaa', 'bbbb', 'cccc'])
})

test('a short pane above the prompt still shows all three numbers', async $ => {
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
    expect(drawn).not.toMatch(/█/)
    await ui.unmount()
  }
})

test('the usage rate reads idle when nothing streams', async () => {
  expect(view(1, 1, 0).text.rate).toBe('usage rate  idle')
  expect(view(1, 1, 12.6).text.rate).toBe('usage rate  12.6 mL/min')
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
      usage: usage('claude-sonnet-4-5'),
    }
  })
  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-4-5', messageCount: 1 })
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
    // Emoji widths differ between terminals and shift every cell drawn after one.
    if (surface === 'terminal') expect(/\p{Extended_Pictographic}/u.test(drawn)).toBe(false)
    else expect(drawn).toMatch(/<svg/)
    await ui.unmount()
  }
})
