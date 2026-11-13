import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { CARBON, ENERGY, WATER, cardSvg, co2, fmtCo2, fmtMl, fmtUsd, fmtWh, ml, passed, view } from '../../core/footprint.ts'
import { costNote, parseLine, start, tally, whLastMinute, type Tally } from './copilotLog.ts'

// Copilot Chat runs a request in one of two places, each with its own usage log
// settings: VS Code's agent host (1.146 and later) or the Copilot Chat extension.
const LOGS = [
  { section: 'chat.agentHost.otel', file: { exporterType: 'file' } },
  { section: 'github.copilot.chat.otel', file: {} },
]
const config = (section: string) => vscode.workspace.getConfiguration(section)
// Settings this VS Code knows; the agent host's are missing from older versions.
const known = () => LOGS.filter(l => config(l.section).inspect('enabled')?.defaultValue !== undefined)
const VIEW = 'tokenFootprint.card'
// ponytail: the shared log grows across every window; start it over past this size.
const MAX_LOG_BYTES = 100 * 1024 * 1024

export function activate(context: vscode.ExtensionContext) {
  const ourLog = path.join(context.globalStorageUri.fsPath, 'copilot-otel.jsonl')
  // Copilot sets this variable in the extension host every extension shares, to /dev/null while its log is off.
  const fromEnv = () => (process.env.COPILOT_OTEL_FILE_EXPORTER_PATH === os.devNull ? '' : process.env.COPILOT_OTEL_FILE_EXPORTER_PATH)
  const logPath = () => fromEnv() || LOGS.map(l => config(l.section).get<string>('outfile')).find(Boolean) || ''

  let t: Tally = start()
  let webview: vscode.Webview | undefined
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.command = `${VIEW}.focus`
  context.subscriptions.push(status)

  const render = () => {
    const last = t.prompts.at(-1)
    const note = costNote(t)
    const v = view(t.total.wh, last?.wh ?? 0, ml(whLastMinute(t, Date.now())), t.total.usd, last?.usd ?? 0, note)
    status.text = `$(flame) ${fmtMl(ml(v.wh))} · ${fmtWh(v.wh)} · ${fmtCo2(co2(v.wh))} CO2 · ${fmtUsd(v.usd)}`
    status.tooltip = `Token Footprint: Copilot Chat usage since this window opened. Cost ${note}.`
    status.show()
    if (webview) webview.html = page(logPath() ? `${cardSvg(v, t.prompts)}${t.prompts.length ? '' : WAITING}` : SET_UP)
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW, {
      resolveWebviewView(panel) {
        panel.webview.options = { enableCommandUris: ['tokenFootprint.setUp'] }
        webview = panel.webview
        panel.onDidDispose(() => (webview = undefined))
        render()
      },
    }),
    vscode.commands.registerCommand('tokenFootprint.setUp', () => setUp(ourLog)),
  )

  // Read what Copilot appends to the log. The agent host serves every window and
  // marks no window on its records, so each window counts all of them.
  let file = ''
  let offset = 0
  let partial = ''
  const readNew = () => {
    let size: number
    try {
      size = fs.statSync(file).size
    } catch {
      return
    }
    if (size < offset) offset = 0 // started over
    if (size === offset) return
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - offset)
    fs.readSync(fd, buf, 0, buf.length, offset)
    fs.closeSync(fd)
    offset = size
    const lines = (partial + buf.toString('utf8')).split('\n')
    partial = lines.pop() ?? ''
    const before = t.total
    for (const line of lines) {
      const call = parseLine(line)
      if (call) t = tally(t, call)
    }
    if (t.total === before) return
    const news = [
      passed(WATER, ml(before.wh), ml(t.total.wh)),
      passed(ENERGY, before.wh, t.total.wh),
      passed(CARBON, co2(before.wh), co2(t.total.wh)),
    ].filter(Boolean)
    if (news.length) vscode.window.setStatusBarMessage(`Footprint just passed ${news.map(m => m![2]).join(' · ')}`, 6000)
    render()
  }
  const watch = () => {
    if (file) fs.unwatchFile(file)
    file = logPath()
    if (!file) return
    try {
      offset = fs.statSync(file).size
      if (file === ourLog && offset > MAX_LOG_BYTES) fs.truncateSync(file, (offset = 0))
    } catch {
      offset = 0
    }
    partial = ''
    fs.watchFile(file, { interval: 1000 }, readNew)
  }
  watch()
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => LOGS.some(l => e.affectsConfiguration(`${l.section}.outfile`)) && (watch(), render())),
    { dispose: () => file && fs.unwatchFile(file) },
  )
  // The usage rate falls back to idle once the last minute is quiet.
  let rate = 0
  const timer = setInterval(() => {
    const now = whLastMinute(t, Date.now())
    if (now !== rate) (rate = now), render()
  }, 5000)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  render()

  if (!logPath() && !context.globalState.get('setUpAsked')) {
    void context.globalState.update('setUpAsked', true)
    void vscode.window
      .showInformationMessage('Token Footprint reads Copilot Chat’s usage log, which is off. Turn it on?', 'Turn on', 'Not now')
      .then(pick => {
        if (pick === 'Turn on') void setUp(ourLog)
      })
  }
}

// Points Copilot Chat's OpenTelemetry export at a local file. Prompt and reply
// text stay out of it: captureContent is left as it is (off by default).
async function setUp(ourLog: string) {
  const logs = known()
  const busy = logs.map(l => config(l.section)).find(c => c.get('enabled') && c.get('exporterType') !== 'file' && !c.get('outfile'))
  if (busy) {
    const pick = await vscode.window.showWarningMessage(
      `Copilot Chat already sends telemetry over ${busy.get('exporterType')}. Turning on the usage log sends it to a local file instead.`,
      'Switch to file',
      'Cancel',
    )
    if (pick !== 'Switch to file') return
  }
  fs.mkdirSync(path.dirname(ourLog), { recursive: true })
  for (const l of logs)
    for (const [key, value] of Object.entries({ enabled: true, ...l.file, outfile: ourLog }))
      await config(l.section).update(key, value, vscode.ConfigurationTarget.Global)
  // An organization's policy outranks user settings, and Copilot reads the setting it wins.
  if (logs.some(l => config(l.section).get<string>('outfile') !== ourLog)) {
    void vscode.window.showWarningMessage('Your organization manages Copilot’s telemetry settings, so Token Footprint can’t turn on the usage log.')
    return
  }
  const pick = await vscode.window.showInformationMessage(
    'Copilot Chat starts writing its usage log after a reload. If VS Code asks to restart, choose Restart.',
    'Reload window',
  )
  if (pick) void vscode.commands.executeCommand('workbench.action.reloadWindow')
}

const SET_UP = `<p>Token Footprint reads Copilot Chat’s usage log, which is off.</p>
<p><a href="command:tokenFootprint.setUp">Turn on the usage log</a></p>
<p class="dim">This writes model names and token counts to a local file. Prompt and reply text are not included.</p>`
const WAITING = `<p class="dim">Waiting for Copilot Chat’s next request.</p>`

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{margin:0;padding:8px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}svg{width:100%;max-width:380px;height:auto;display:block}.dim{opacity:.7}a{color:var(--vscode-textLink-foreground)}</style>
</head><body>${body}</body></html>`
