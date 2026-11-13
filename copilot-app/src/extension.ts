import { createServer, type ServerResponse } from 'node:http'

import { createCanvas, joinSession } from '@github/copilot-sdk/extension'

import { cardSvg, ml, view } from '../../core/footprint.ts'
import { costNote, start, tally, whLastMinute, type Tally } from '../../vscode/src/copilotLog.ts'
import { usageOf } from './usage.ts'

// The Footprint canvas for the GitHub Copilot app: the session's water,
// electricity, CO2 and cost, from each model call's usage event. The app shows
// the page this extension serves on a loopback port in its side panel.
// stdout carries the app's JSON-RPC: never console.log here.

const CANVAS = 'footprint'

let t: Tally = start()
let prompt = 0
const pages = new Set<ServerResponse>()

const card = () => {
  const last = t.prompts.at(-1)
  const v = view(t.total.wh, last?.wh ?? 0, ml(whLastMinute(t, Date.now())), t.total.usd, last?.usd ?? 0, costNote(t))
  return cardSvg(v, t.prompts)
}
const push = () => {
  const data = `data: ${JSON.stringify(card())}\n\n`
  for (const res of pages) res.write(data)
}

const PAGE = (svg: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Footprint</title>
<style>:root{--status-bar-color:var(--background-color-default,#0f1b2e)}body{margin:0;padding:12px;background:var(--background-color-default,#0f1b2e)}svg{width:100%;max-width:380px;height:auto;display:block;margin:0 auto}</style>
</head><body><div id="card">${svg}</div>
<script>new EventSource('/events').onmessage = e => { document.getElementById('card').innerHTML = JSON.parse(e.data) }</script>
</body></html>`

// One loopback server for every panel: they all show the same session.
let url: Promise<string> | undefined
const serve = () =>
  (url ??= new Promise(resolve => {
    const server = createServer((req, res) => {
      if (req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write(`data: ${JSON.stringify(card())}\n\n`)
        pages.add(res)
        req.on('close', () => pages.delete(res))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(PAGE(card()))
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`)
    })
  }))

const session = await joinSession({
  canvases: [
    createCanvas({
      id: CANVAS,
      displayName: 'Footprint',
      description: 'Water, electricity, CO2 and cost of this session’s model requests, estimated from their tokens.',
      open: async () => ({ title: 'Footprint', url: await serve() }),
    }),
  ],
})

// A prompt is everything Copilot does for one user message.
session.on('user.message', () => {
  prompt += 1
})
session.on('assistant.usage', e => {
  t = tally(t, { trace: String(prompt), endMs: Date.parse(e.timestamp) || Date.now(), usage: usageOf(e.data) })
  push()
})

// The usage rate falls back to idle once the last minute is quiet.
let rate = 0
setInterval(() => {
  const now = whLastMinute(t, Date.now())
  if (now !== rate) (rate = now), push()
}, 5000).unref()

// Open the panel with the session, as the Claude Code pane does.
session.rpc.canvas.open({ canvasId: CANVAS, instanceId: CANVAS }).catch(() => {})
