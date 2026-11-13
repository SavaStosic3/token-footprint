import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  CARBON,
  CARBON_COLOR,
  COST_COLOR,
  ENERGY,
  ENERGY_COLOR,
  WATER,
  WATER_COLOR,
  WH_PER_TOKEN,
  ZERO,
  addUsage,
  cardSvg,
  co2,
  fmtCo2,
  fmtMl,
  fmtUsd,
  fmtWh,
  ml,
  passed,
  scaleOf,
  view,
} from '../core/footprint'
import type { Live, Prompt } from '../types'

// Streamed text counts live at ~4 characters a token until the step's real usage replaces it.
const CHARS_PER_TOKEN = 4
const TICK_MS = 1000

const PANE = 'token-footprint'

const total = atom({ plugin: 'token-footprint', key: 'total' } as const, ZERO)
const prompts = atom({ plugin: 'token-footprint', key: 'prompts' } as const, [])
const live = atom({ plugin: 'token-footprint', key: 'live' } as const, { pendingWh: 0, mlPerMin: 0 })

// Streams in flight, kept in the module: a reload drops them with the streams they tracked.
let pendingWh = 0
let burnedWh = 0
let inFlight = 0

const meter = (fill: number) => '█'.repeat(Math.round(fill * 16)).padEnd(16, '░')
const spark = (list: Prompt[]) => {
  const shown = list.slice(-40)
  const max = Math.max(...shown.map(p => p.wh), 1e-9)
  return shown.map(p => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((p.wh / max) * 8))]).join('')
}
// Rows the full terminal view needs; with less room the compact one draws instead.
const FULL_ROWS = 18
type Span = { text: string; color?: string; bold?: boolean }
// Packs parts (runs of spans) into as few lines as fit the width, joined by " · ".
export function pack(parts: Span[][], width: number): Span[][] {
  const len = (spans: Span[]) => spans.reduce((n, s) => n + s.text.length, 0)
  const lines: Span[][] = []
  for (const part of parts) {
    const last = lines.at(-1)
    if (last && len(last) + 3 + len(part) <= width) last.push({ text: ' · ' }, ...part)
    else lines.push([...part])
  }
  return lines
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'footprint', description: 'Show the water, electricity, CO2 and cost this session has used' })
    void $.ui.open({ id: PANE, title: 'Footprint' })

    // Turn the burn of the streams in flight into a usage rate, once a second.
    let lastBurned = burnedWh
    let mlPerMin = 0
    let shown: Live | undefined
    $.clock.every(TICK_MS, () => {
      mlPerMin = mlPerMin * 0.5 + ml(((burnedWh - lastBurned) * 60000) / TICK_MS) * 0.5
      lastBurned = burnedWh
      const now: Live = { pendingWh: Math.max(0, pendingWh), mlPerMin: mlPerMin < 0.05 ? 0 : Math.round(mlPerMin * 10) / 10 }
      if (shown && now.pendingWh === shown.pendingWh && now.mlPerMin === shown.mlPerMin) return
      shown = now
      void update($, live, () => now)
    })
    return next(e)
  })

  on('command.run', { command: 'footprint' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Footprint' })
    return { text: opened.isPlaced ? 'Footprint pane opened.' : `The Footprint pane can't be shown here yet: ${opened.reason}` }
  })

  // Subagent runs raise no turn.start, so their steps add to the prompt that spawned them.
  on('turn.start', async ($, e, next) => {
    const prompt: Prompt = { ...ZERO, label: e.text.slice(0, 80) || '(continuation)' }
    await update($, prompts, list => [...list, prompt].slice(-500))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const scale = scaleOf(e.model)
    let streamedWh = 0
    const stream = next(e)
    inFlight += 1
    try {
      for await (const chunk of stream) {
        const chars = chunk.kind === 'text' || chunk.kind === 'thinking' ? chunk.text.length : chunk.kind === 'input' ? chunk.json.length : 0
        const wh = (chars / CHARS_PER_TOKEN) * WH_PER_TOKEN.output * scale
        streamedWh += wh
        pendingWh += wh
        burnedWh += wh
        yield chunk
      }
    } finally {
      inFlight -= 1
      pendingWh = inFlight === 0 ? 0 : pendingWh - streamedWh
    }

    const result = await stream.result
    const usage = result.usage
    if (usage) {
      await update($, prompts, list => {
        const [last = { ...ZERO, label: '(background)' }] = list.slice(-1)
        return [...list.slice(0, -1), addUsage(last, usage)]
      })
      const before = (await read($, total)).wh
      const sum = await update($, total, s => addUsage(s, usage))
      const water = passed(WATER, ml(before), ml(sum.wh))
      const power = passed(ENERGY, before, sum.wh)
      const carbon = passed(CARBON, co2(before), co2(sum.wh))
      const news = [
        water && `Session water just passed ${water[2]}`,
        power && `Session energy just passed ${power[2]}`,
        carbon && `Session CO2 just passed ${carbon[2]}`,
      ].filter(Boolean)
      if (news.length > 0) $.ui.toast(news.join('  ·  '))
      $.ui.status(`water ${fmtMl(ml(sum.wh))} · energy ${fmtWh(sum.wh)} · CO2 ${fmtCo2(co2(sum.wh))} · cost ${fmtUsd(sum.usd)}`)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const sum = await read($, total)
    const list = await read($, prompts)
    const now = await read($, live)
    const v = view(sum.wh + now.pendingWh, (list.at(-1)?.wh ?? 0) + now.pendingWh, now.mlPerMin, sum.usd ?? 0, list.at(-1)?.usd ?? 0)
    const t = v.text

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const { placement, bodyColumns, scroll } = e.props
      // Above the prompt, or docked but short: pack the numbers into as few lines as the room holds,
      // dropping the comparisons when even that is too tall, so all three always show.
      if (placement === 'inline' || scroll.bodyRows < FULL_ROWS) {
        const flat = (s: string) => s.replace(/\s+/g, ' ')
        const head = (s: string, color: string): Span => ({ text: flat(s), color, bold: true })
        const rate: Span = { text: flat(t.rate), ...(v.mlPerMin > 0 ? { color: WATER_COLOR } : {}) }
        const roomy = pack(
          [
            [head(t.water, WATER_COLOR), { text: ` ${t.waterSub}` }],
            [head(t.energy, ENERGY_COLOR), { text: ` ${t.energySub}` }],
            [head(t.carbon, CARBON_COLOR), { text: ` ${t.carbonSub}` }],
            [head(t.cost, COST_COLOR), { text: ` ${t.costSub}` }],
            [{ text: flat(t.prompt) }],
            [rate],
          ],
          bodyColumns,
        )
        const lines =
          roomy.length <= scroll.bodyRows
            ? roomy
            : pack(
                [[head(t.water, WATER_COLOR)], [head(t.energy, ENERGY_COLOR)], [head(t.carbon, CARBON_COLOR)], [head(t.cost, COST_COLOR)], [rate]],
                bodyColumns,
              )
        return (
          <Box flexDirection="column">
            {lines.map(line => (
              <Text>{line.map(s => (s.color ? <Text color={s.color} bold={s.bold === true}>{s.text}</Text> : <Text dimColor>{s.text}</Text>))}</Text>
            ))}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>
              <Text bold color={WATER_COLOR}>{t.water}</Text>
              <Text dimColor>  {t.waterSub}</Text>
            </Text>
            <Text>
              <Text color={WATER_COLOR}>{meter(v.water.fill)}</Text>
              <Text dimColor>  {t.waterNext}</Text>
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text>
              <Text bold color={ENERGY_COLOR}>{t.energy}</Text>
              <Text dimColor>  {t.energySub}</Text>
            </Text>
            <Text>
              <Text color={ENERGY_COLOR}>{meter(v.power.fill)}</Text>
              <Text dimColor>  {t.energyNext}</Text>
            </Text>
          </Box>
          <Box flexDirection="column">
            <Text>
              <Text bold color={CARBON_COLOR}>{t.carbon}</Text>
              <Text dimColor>  {t.carbonSub}</Text>
            </Text>
            <Text>
              <Text color={CARBON_COLOR}>{meter(v.carbon.fill)}</Text>
              <Text dimColor>  {t.carbonNext}</Text>
            </Text>
          </Box>
          <Text>
            <Text bold color={COST_COLOR}>{t.cost}</Text>
            <Text dimColor>  {t.costSub}</Text>
          </Text>
          <Box flexDirection="column">
            <Text dimColor>{t.prompt}</Text>
            {v.mlPerMin > 0 ? <Text color={WATER_COLOR}>{t.rate}</Text> : <Text dimColor>{t.rate}</Text>}
            {list.length > 1 && (
              <Text>
                <Text dimColor>per prompt  </Text>
                <Text color={ENERGY_COLOR}>{spark(list)}</Text>
              </Text>
            )}
          </Box>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    return <Svg source={cardSvg(v, list)} alt={Object.values(t).join('. ')} />
  })
}
