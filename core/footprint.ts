import type { Prompt, Usage } from '../types'

// Everything that does not depend on the host: the estimates, the prices, the
// text and the card. The Claude Code plugin (hooks/), the VS Code extension
// (vscode/) and the GitHub Copilot app canvas (copilot-app/) all draw from here.

// One model request's token counts, in Anthropic's shape: input_tokens excludes
// the cache reads and writes, which are counted on their own.
export type TokenUsage = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  // What the host itself charged for this request, in USD, when it reports one.
  // It takes the place of the estimate from API list prices.
  usd?: number
}

// --- Calibration knobs -------------------------------------------------------
// Wh per token for a Sonnet-class model. Output ~0.5 mWh is the mid-range of
// Epoch AI's 2025 per-token estimates; it puts a typical chat reply near the
// ~0.3 Wh per query that Google (0.24), OpenAI (0.34) and Microsoft Research
// (0.31, Joule 2026) report. Input-side weights follow Anthropic's price
// ratios: fresh input 1/5 of output, cache write 1.25x input, cache read 0.1x.
export const WH_PER_TOKEN = { output: 0.0005, input: 0.0001, cacheWrite: 0.000125, cacheRead: 0.00001 }
// Model size relative to a Sonnet-class model: small 0.33, mid-size 1, large 1.67,
// after GitHub Copilot's Lightweight / Versatile / Powerful grouping of the models
// it offers. Fable and GPT-6 Astra list at twice the large models' price, so count
// double them. Ids that match nothing count as large.
const MODEL_SCALE: [RegExp, number][] = [
  [/haiku|luna|mai-code|flash-lite|-mini\b|-nano\b/i, 0.33],
  [/sonnet|terra|hydrogen|flash/i, 1],
  [/fable|astra/i, 3.33],
  [/opus|-sol\b|argon|carbon/i, 1.67],
]
const DEFAULT_SCALE = 1.67
// mL of water per Wh (= L/kWh). Cooling: Google's Gemini disclosure (0.26 mL
// per 0.24 Wh). Power: water evaporated making the electricity (US grid avg,
// Li et al., "Making AI Less Thirsty").
const ML_PER_WH = { cooling: 1.1, power: 3.1 }
// g CO2e per Wh (= kg/kWh): US grid average, EPA eGRID 2023 (~0.35 kg CO2e/kWh).
const G_CO2_PER_WH = 0.35
// g CO2 per km for a typical passenger car (EPA: ~400 g per mile).
const G_CO2_PER_KM = 400 / 1.609
// USD per 1M tokens, Standard tier, from each provider's pricing page (checked 2026-11-15).
// Cache writes use the shortest retention (Anthropic 5 min, OpenAI 30 min).
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number }
const usd = (input: number, output: number, cacheWrite: number, cacheRead: number): Price => ({ input, output, cacheWrite, cacheRead })
// Google's launch prices double on a set date. Gemini has no cache-write price, so writes bill as plain input.
const until = (year: number, month: number, before: Price, after: Price) => (Date.now() < Date.UTC(year, month - 1, 1) ? before : after)
const GEMINI_4 = until(2026, 12, usd(2, 10, 2, 0.1), usd(4, 20, 4, 0.2))
const GEMINI_FLASH = until(2027, 1, usd(0.75, 3.75, 0.75, 0.075), usd(1.5, 7.5, 1.5, 0.15))
// A request whose prompt passes this many tokens bills wholly at the model's long-prompt price.
const LONG_PROMPT = 272_000
// [model, price, long-prompt price, long-prompt threshold when it isn't LONG_PROMPT]. First match wins.
// Copilot spells versions with dots (claude-opus-5.5), Claude Code with dashes.
const PRICES: [RegExp, Price, Price?, number?][] = [
  [/fable-5[.-]2/i, usd(8, 40, 10, 0.2)],
  [/opus-5[.-]5/i, usd(4, 20, 5, 0.2)],
  [/opus-5(?![.-]\d)/i, usd(5, 25, 6.25, 0.5)],
  [/sonnet-5[.-]5/i, usd(2, 10, 2.5, 0.1)],
  [/sonnet-5(?![.-]\d)/i, usd(2, 10, 2.5, 0.2)],
  [/haiku-5[.-]5/i, usd(0.1, 0.5, 0.125, 0.01), usd(0.5, 2.5, 0.625, 0.05), 100_000],
  [/gpt-6[.-]1-sol/i, usd(2, 10, 2.5, 0.1), usd(4, 15, 5, 0.2)],
  [/gpt-6[.-]1-terra/i, usd(1, 5, 1.25, 0.05), usd(2, 7.5, 2.5, 0.1)],
  [/gpt-6-sol/i, usd(2, 10, 2.5, 0.2), usd(4, 15, 5, 0.4)],
  [/gpt-6-luna/i, usd(0.1, 0.5, 0.125, 0.01), usd(0.2, 0.75, 0.25, 0.02)],
  [/gemini-4-argon/i, GEMINI_4],
  // Google lists Gemini 4 Carbon; match a 5 too in case that is the id in use.
  [/gemini-[45]-carbon/i, GEMINI_4],
  [/gemini-4-hydrogen/i, usd(1.5, 7.5, 1.5, 0.075)],
  [/gemini-3[.-]8-flash/i, GEMINI_FLASH],
  // Copilot's Auto pick. Priced on GitHub's Copilot models page; Microsoft sells it nowhere else.
  [/mai-code-1[.-]1-flash/i, usd(0.2, 1.2, 0.25, 0.02)],
]

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
// CO2 compares to driving a typical car, at every scale.
export const CARBON: Milestone[] = [0.1, 1, 10, 100, 1000].map(km => {
  const trip = `${km < 1 ? `${km * 1000} m` : `${km} km`} of driving`
  return [km * G_CO2_PER_KM, '🚗', trip, trip]
})

export const WATER_COLOR = '#38bdf8'
export const ENERGY_COLOR = '#f59e0b'
export const CARBON_COLOR = '#a78bfa'
export const COST_COLOR = '#34d399'
// Shown beside a cost that leaves out calls to models with no price on file.
export const NO_PRICE = 'some models have no price'
export const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, wh: 0, usd: 0 }

export const scaleOf = (model: string) => MODEL_SCALE.find(([re]) => re.test(model))?.[1] ?? DEFAULT_SCALE

export function addUsage<T extends Usage>(sum: T, u: TokenUsage): T {
  const wh =
    scaleOf(u.model) *
    (u.input_tokens * WH_PER_TOKEN.input +
      u.output_tokens * WH_PER_TOKEN.output +
      u.cache_creation_input_tokens * WH_PER_TOKEN.cacheWrite +
      u.cache_read_input_tokens * WH_PER_TOKEN.cacheRead)
  const [, short, long, threshold = LONG_PROMPT] = PRICES.find(([re]) => re.test(u.model)) ?? []
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const p = prompt > threshold && long ? long : short
  const cost =
    u.usd ??
    (p
      ? (u.input_tokens * p.input +
          u.output_tokens * p.output +
          u.cache_creation_input_tokens * p.cacheWrite +
          u.cache_read_input_tokens * p.cacheRead) /
        1e6
      : undefined)
  return {
    ...sum,
    input: sum.input + u.input_tokens,
    output: sum.output + u.output_tokens,
    cacheRead: sum.cacheRead + u.cache_read_input_tokens,
    cacheWrite: sum.cacheWrite + u.cache_creation_input_tokens,
    wh: sum.wh + wh,
    // Totals saved before cost existed have no usd.
    usd: (sum.usd ?? 0) + (cost ?? 0),
    ...(cost === undefined ? { unpriced: (sum.unpriced ?? 0) + 1 } : {}),
  }
}

export const ml = (wh: number) => wh * (ML_PER_WH.cooling + ML_PER_WH.power)
export const co2 = (wh: number) => wh * G_CO2_PER_WH

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
export const fmtWh = (wh: number) => (wh < 1 ? `${(wh * 1000).toFixed(0)} mWh` : wh < 1000 ? `${sig(wh)} Wh` : `${sig(wh / 1000)} kWh`)
export const fmtMl = (v: number) => (v < 100 ? `${v.toFixed(1)} mL` : v < 1000 ? `${v.toFixed(0)} mL` : `${sig(v / 1000)} L`)
export const fmtCo2 = (g: number) => (g < 1000 ? `${sig(g)} g` : g < 1e6 ? `${sig(g / 1000)} kg` : `${sig(g / 1e6)} t`)
export const fmtUsd = (x: number) => `$${x.toFixed(2)} USD`
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`)
const times = (n: number) => (n < 10 ? n.toFixed(1) : `${Math.round(n)}`)
const bare = (m: Milestone) => m[2].replace(/^an? /, '')

export const passed = (steps: Milestone[], before: number, after: number) => steps.filter(([size]) => before < size && after >= size).at(-1)

// Everything a drawing needs. Its text has no emoji: terminals disagree on their
// width, which shifts every cell drawn after one. The desktop card carries the icons.
// costNote says where the cost comes from, beside it on the card.
export function view(wh: number, promptWh: number, mlPerMin: number, usd: number, promptUsd: number, costNote = 'at API list price') {
  const water = gauge(ml(wh), WATER)
  const power = gauge(wh, ENERGY)
  const carbon = gauge(co2(wh), CARBON)
  const next = (g: Gauge) => (g.next ? `next: ${bare(g.next)} ${Math.round(g.fill * 100)}%` : 'off the charts')
  const rate = mlPerMin > 0 ? `${mlPerMin.toFixed(1)} mL/min` : 'idle'
  return {
    wh,
    promptWh,
    mlPerMin,
    usd,
    water,
    power,
    carbon,
    rate,
    text: {
      water: `water  ${fmtMl(ml(wh))}`,
      waterSub: `≈ ${times(water.count)} ${water.many}`,
      waterNext: next(water),
      energy: `energy ${fmtWh(wh)}`,
      energySub: `≈ ${times(power.count)} ${power.many}`,
      energyNext: next(power),
      carbon: `CO2    ${fmtCo2(co2(wh))}`,
      carbonSub: `≈ ${fmtKm(co2(wh) / G_CO2_PER_KM)} of driving`,
      carbonNext: next(carbon),
      cost: `cost   ${fmtUsd(usd)}`,
      costSub: `this prompt ${fmtUsd(promptUsd)}`,
      costNote,
      prompt: `this prompt  ${fmtMl(ml(promptWh))} · ${fmtWh(promptWh)} · ${fmtCo2(co2(promptWh))} CO2`,
      rate: `usage rate  ${rate}`,
    },
  }
}
export type View = ReturnType<typeof view>

// The desktop card: a still image, so it can redraw every second without flashing.
export function cardSvg(v: View, list: Prompt[]): string {
  const t = v.text
  const row = (y: number, tint: string, label: string, amount: string, sub: string, next: string) => {
    const [num, unit] = amount.split(' ')
    return `<rect x="14" y="${y}" width="352" height="58" rx="14" fill="${tint}" fill-opacity="0.08" stroke="${tint}" stroke-opacity="0.3"/>
<text x="28" y="${y + 21}" font-size="9.5" font-weight="700" letter-spacing="1.5" fill="${tint}">${label}</text>
<text x="28" y="${y + 47}" fill="#f8fafc" style="font-variant-numeric: tabular-nums"><tspan font-size="24" font-weight="700">${num}</tspan><tspan font-size="12" font-weight="600" fill="${tint}" dx="4">${unit}</tspan></text>
<text x="352" y="${y + 21}" font-size="10" fill="#64748b" text-anchor="end">${next}</text>
<text x="352" y="${y + 45}" font-size="12" fill="#cbd5e1" text-anchor="end">${sub}</text>`
  }
  const chip = (x: number, width: number, label: string, value: string, color: string) =>
    `<rect x="${x}" y="280" width="${width}" height="50" rx="12" fill="#ffffff" fill-opacity="0.03" stroke="#1e2a44"/>
<text x="${x + 14}" y="299" font-size="9.5" font-weight="700" letter-spacing="1.5" fill="#64748b">${label}</text>
<text x="${x + 14}" y="319" font-size="13" font-weight="600" fill="${color}" style="font-variant-numeric: tabular-nums">${value}</text>`

  // The last bar is the prompt in flight, so it grows with the stream.
  const values = [...list.slice(-30).map(p => p.wh).slice(0, -1), v.promptWh]
  const max = Math.max(...values, 1e-9)
  const hasGraph = list.length > 1
  const bars = values
    .map((wh, i) => {
      const barH = Math.max(2, (wh / max) * 36)
      return `<rect x="${30 + i * 10.67 + 1}" y="${402 - barH}" width="8.67" height="${barH}" rx="2" fill="url(#bar)" opacity="${i === values.length - 1 ? 1 : 0.55}"/>`
    })
    .join('')
  const height = hasGraph ? 418 : 344

  return `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="${height}" viewBox="0 0 380 ${height}" font-family="ui-sans-serif, system-ui, 'Segoe UI', sans-serif">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1b2e"/><stop offset="1" stop-color="#0a1220"/></linearGradient>
<linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#fcd34d"/></linearGradient></defs>
<rect x="0.5" y="0.5" width="379" height="${height - 1}" rx="18" fill="url(#bg)" stroke="#1e2a44"/>
${row(14, WATER_COLOR, '💧 WATER', fmtMl(ml(v.wh)), `${t.waterSub} ${v.water.icon}`, t.waterNext)}
${row(80, ENERGY_COLOR, '⚡ ELECTRICITY', fmtWh(v.wh), `${t.energySub} ${v.power.icon}`, t.energyNext)}
${row(146, CARBON_COLOR, '💨 CO₂', fmtCo2(co2(v.wh)), `${t.carbonSub} 🚗`, t.carbonNext)}
${row(212, COST_COLOR, '💵 COST', fmtUsd(v.usd), t.costSub, t.costNote)}
${chip(14, 230, 'THIS PROMPT', `${fmtMl(ml(v.promptWh))} · ${fmtWh(v.promptWh)} · ${fmtCo2(co2(v.promptWh))}`, '#e2e8f0')}
${chip(256, 110, 'USAGE RATE', v.rate, v.mlPerMin > 0 ? '#7dd3fc' : '#64748b')}
${
  hasGraph
    ? `<text x="16" y="356" font-size="9.5" font-weight="700" letter-spacing="1.5" fill="#64748b">USAGE PER PROMPT</text>
<text x="364" y="356" font-size="10" fill="#64748b" text-anchor="end">tallest ${fmtWh(max)}</text>${bars}
<line x1="30" y1="402.5" x2="350" y2="402.5" stroke="#263247"/>`
    : ''
}</svg>`
}
