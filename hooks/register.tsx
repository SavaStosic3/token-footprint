import { atom, read, update } from 'claude-code'
import type { Register, TurnUsage } from 'claude-code'

import type { Live, Prompt, Usage } from '../types'

// --- Calibration knobs -------------------------------------------------------
// Wh per token for a Sonnet-class model. Output ~0.5 mWh is the mid-range of
// Epoch AI's 2025 per-token estimates; it puts a typical chat reply near the
// ~0.3 Wh per query that Google (0.24), OpenAI (0.34) and Microsoft Research
// (0.31, Joule 2026) report. Input-side weights follow Anthropic's price
// ratios: fresh input 1/5 of output, cache write 1.25x input, cache read 0.1x.
const WH_PER_TOKEN = { output: 0.0005, input: 0.0001, cacheWrite: 0.000125, cacheRead: 0.00001 }
// Model size relative to Sonnet, by list price. Unknown ids get the Opus factor.
const MODEL_SCALE: [RegExp, number][] = [[/haiku/i, 0.33], [/sonnet/i, 1], [/opus/i, 1.67]]
const DEFAULT_SCALE = 1.67
// mL of water per Wh (= L/kWh). Cooling: Google's Gemini disclosure (0.26 mL
// per 0.24 Wh). Power: water evaporated making the electricity (US grid avg,
// Li et al., "Making AI Less Thirsty").
const ML_PER_WH = { cooling: 1.1, power: 3.1 }
// Streamed text counts live at ~4 characters a token until the step's real usage replaces it.
const CHARS_PER_TOKEN = 4
const TICK_MS = 1000

type Milestone = [size: number, icon: string, one: string, many: string]
export const WATER: Milestone[] = [
  [0.05, '💧', 'a drop', 'drops'],
  [5, '🥄', 'a teaspoon', 'teaspoons'],
  [44, '🥃', 'a shot glass', 'shot glasses'],
  [250, '🥛', 'a glass', 'glasses'],
  [500, '🫗', 'a bottle', 'bottles'],
  [2000, '🚰', "a day's drinking water", 'days of drinking water'],
  [10000, '🪣', 'a bucket', 'buckets'],
  [65000, '🚿', 'an 8-minute shower', '8-minute showers'],
  [150000, '🛁', 'a bathtub', 'bathtubs'],
]
export const ENERGY: Milestone[] = [
  [0.3, '🔎', 'a web search', 'web searches'],
  [2, '📺', 'a minute of TV', 'minutes of TV'],
  [10, '💡', 'an hour of LED light', 'hours of LED light'],
  [15, '📱', 'a phone charge', 'phone charges'],
  [50, '💻', 'an hour of laptop use', 'laptop-hours'],
  [100, '☕', 'a kettle boil', 'kettle boils'],
  [300, '🚗', 'a mile in an EV', 'EV miles'],
  [1500, '🧊', 'a day of fridge', 'fridge-days'],
  [29000, '🏠', 'a day of a US home', 'US home-days'],
]

const WATER_COLOR = '#38bdf8'
const ENERGY_COLOR = '#f59e0b'
const PANE = 'token-footprint'
const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wh: 0 }

const total = atom({ plugin: 'token-footprint', key: 'total' } as const, ZERO)
const prompts = atom({ plugin: 'token-footprint', key: 'prompts' } as const, [])
const live = atom({ plugin: 'token-footprint', key: 'live' } as const, { pendingWh: 0, mlPerMin: 0 })

// Streams in flight, kept in the module: a reload drops them with the streams they tracked.
let pendingWh = 0
let burnedWh = 0
let inFlight = 0

const scaleOf = (model: string) => MODEL_SCALE.find(([re]) => re.test(model))?.[1] ?? DEFAULT_SCALE

export function addUsage<T extends Usage>(sum: T, u: TurnUsage): T {
  const wh =
    scaleOf(u.model) *
    (u.input_tokens * WH_PER_TOKEN.input +
      u.output_tokens * WH_PER_TOKEN.output +
      u.cache_creation_input_tokens * WH_PER_TOKEN.cacheWrite +
      u.cache_read_input_tokens * WH_PER_TOKEN.cacheRead)
  return {
    ...sum,
    input: sum.input + u.input_tokens,
    output: sum.output + u.output_tokens,
    cacheRead: sum.cacheRead + u.cache_read_input_tokens,
    cacheWrite: sum.cacheWrite + u.cache_creation_input_tokens,
    wh: sum.wh + wh,
  }
}

export const ml = (wh: number) => wh * (ML_PER_WH.cooling + ML_PER_WH.power)

// The biggest milestone reached (and how many of it), and how full the next one is.
export function gauge(value: number, steps: Milestone[]) {
  const reached = steps.filter(([size]) => value >= size).length
  const [size, icon, , many] = steps[Math.max(0, reached - 1)]!
  const next = steps[reached]
  return { count: value / size, icon, many, next, fill: next ? Math.min(1, value / next[0]) : 1 }
}
type Gauge = ReturnType<typeof gauge>

// About three significant digits: 2.94 -> "2.94", 47.6 -> "47.6", 476 -> "476".
const sig = (x: number) => x.toFixed(x < 10 ? 2 : x < 100 ? 1 : 0)
const fmtWh = (wh: number) => (wh < 1 ? `${(wh * 1000).toFixed(0)} mWh` : wh < 1000 ? `${sig(wh)} Wh` : `${sig(wh / 1000)} kWh`)
const fmtMl = (v: number) => (v < 100 ? `${v.toFixed(1)} mL` : v < 1000 ? `${v.toFixed(0)} mL` : `${sig(v / 1000)} L`)
const times = (n: number) => (n < 10 ? n.toFixed(1) : `${Math.round(n)}`)
const bare = (m: Milestone) => m[2].replace(/^an? /, '')
const meter = (fill: number) => '█'.repeat(Math.round(fill * 16)).padEnd(16, '░')
const spark = (list: Prompt[]) => {
  const shown = list.slice(-40)
  const max = Math.max(...shown.map(p => p.wh), 1e-9)
  return shown.map(p => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor((p.wh / max) * 8))]).join('')
}
const passed = (steps: Milestone[], before: number, after: number) => steps.filter(([size]) => before < size && after >= size).at(-1)

// Everything a drawing needs. Its text has no emoji: terminals disagree on their
// width, which shifts every cell drawn after one. The desktop card carries the icons.
export function view(wh: number, promptWh: number, mlPerMin: number) {
  const water = gauge(ml(wh), WATER)
  const power = gauge(wh, ENERGY)
  const next = (g: Gauge) => (g.next ? `next: ${bare(g.next)} ${Math.round(g.fill * 100)}%` : 'off the charts')
  const rate = mlPerMin > 0 ? `${mlPerMin.toFixed(1)} mL/min` : 'idle'
  return {
    wh,
    promptWh,
    mlPerMin,
    water,
    power,
    rate,
    text: {
      water: `water  ${fmtMl(ml(wh))}`,
      waterSub: `≈ ${times(water.count)} ${water.many}`,
      waterNext: next(water),
      energy: `energy ${fmtWh(wh)}`,
      energySub: `≈ ${times(power.count)} ${power.many}`,
      energyNext: next(power),
      prompt: `this prompt  ${fmtMl(ml(promptWh))} · ${fmtWh(promptWh)}`,
      rate: `usage rate  ${rate}`,
    },
  }
}
type View = ReturnType<typeof view>

// The desktop card: a still image, so it can redraw every second without flashing.
function cardSvg(v: View, list: Prompt[]): string {
  const tile = (x: number, tint: string, label: string, amount: string, g: Gauge) => {
    const [num, unit] = amount.split(' ')
    const sub = `≈ ${times(g.count)} ${g.many} ${g.icon}`
    return `<rect x="${x}" y="14" width="170" height="92" rx="14" fill="${tint}" fill-opacity="0.08" stroke="${tint}" stroke-opacity="0.3"/>
<text x="${x + 14}" y="36" font-size="10" font-weight="700" letter-spacing="1.5" fill="${tint}">${label}</text>
<text x="${x + 14}" y="72" fill="#f8fafc" style="font-variant-numeric: tabular-nums"><tspan font-size="30" font-weight="700">${num}</tspan><tspan font-size="14" font-weight="600" fill="${tint}" dx="5">${unit}</tspan></text>
<text x="${x + 14}" y="94" font-size="11" fill="#94a3b8"${sub.length > 24 ? ' textLength="142" lengthAdjust="spacingAndGlyphs"' : ''}>${sub}</text>`
  }
  const chip = (x: number, label: string, value: string, color: string) =>
    `<rect x="${x}" y="118" width="170" height="50" rx="12" fill="#ffffff" fill-opacity="0.03" stroke="#1e2a44"/>
<text x="${x + 14}" y="137" font-size="9.5" font-weight="700" letter-spacing="1.5" fill="#64748b">${label}</text>
<text x="${x + 14}" y="157" font-size="13" font-weight="600" fill="${color}" style="font-variant-numeric: tabular-nums">${value}</text>`

  // The last bar is the prompt in flight, so it grows with the stream.
  const values = [...list.slice(-30).map(p => p.wh).slice(0, -1), v.promptWh]
  const max = Math.max(...values, 1e-9)
  const hasGraph = list.length > 1
  const bars = values
    .map((wh, i) => {
      const barH = Math.max(2, (wh / max) * 36)
      return `<rect x="${30 + i * 10.67 + 1}" y="${240 - barH}" width="8.67" height="${barH}" rx="2" fill="url(#bar)" opacity="${i === values.length - 1 ? 1 : 0.55}"/>`
    })
    .join('')
  const height = hasGraph ? 256 : 182

  return `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="${height}" viewBox="0 0 380 ${height}" font-family="ui-sans-serif, system-ui, 'Segoe UI', sans-serif">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1b2e"/><stop offset="1" stop-color="#0a1220"/></linearGradient>
<linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#fcd34d"/></linearGradient></defs>
<rect x="0.5" y="0.5" width="379" height="${height - 1}" rx="18" fill="url(#bg)" stroke="#1e2a44"/>
${tile(14, WATER_COLOR, '💧 WATER', fmtMl(ml(v.wh)), v.water)}
${tile(196, ENERGY_COLOR, '⚡ ELECTRICITY', fmtWh(v.wh), v.power)}
${chip(14, 'THIS PROMPT', `${fmtMl(ml(v.promptWh))} · ${fmtWh(v.promptWh)}`, '#e2e8f0')}
${chip(196, 'USAGE RATE', v.rate, v.mlPerMin > 0 ? '#7dd3fc' : '#64748b')}
${
  hasGraph
    ? `<text x="16" y="194" font-size="9.5" font-weight="700" letter-spacing="1.5" fill="#64748b">USAGE PER PROMPT</text>
<text x="364" y="194" font-size="10" fill="#64748b" text-anchor="end">tallest ${fmtWh(max)}</text>${bars}
<line x1="30" y1="240.5" x2="350" y2="240.5" stroke="#263247"/>`
    : ''
}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'footprint', description: 'Show the water and electricity this session has used' })
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
    await $.ui.open({ id: PANE, title: 'Footprint' })
    return { text: 'Footprint pane opened.' }
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
      const news = [water && `Session water just passed ${water[2]}`, power && `Session energy just passed ${power[2]}`].filter(Boolean)
      if (news.length > 0) $.ui.toast(news.join('  ·  '))
      $.ui.status(`water ${fmtMl(ml(sum.wh))} · energy ${fmtWh(sum.wh)}`)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const sum = await read($, total)
    const list = await read($, prompts)
    const now = await read($, live)
    const v = view(sum.wh + now.pendingWh, (list.at(-1)?.wh ?? 0) + now.pendingWh, now.mlPerMin)
    const t = v.text

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
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
