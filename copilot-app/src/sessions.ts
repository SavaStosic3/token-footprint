import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { ZERO, addUsage } from '../../core/footprint.ts'
import type { Usage } from '../../types/index.d.ts'
import type { Call } from '../../vscode/src/copilotLog.ts'
import { usageOf } from './usage.ts'

// The Copilot runtime (the app, the CLI and VS Code's agent host) saves every
// session's events under its home, one JSON line each. A `session.usage_record`
// line is one model call, a subagent's included, and survives restarts. This
// reads those files: one session as it grows, and every session of a project.

export const copilotHome = () => process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot')
export const sessionFile = (home: string, id: string) => path.join(home, 'session-state', id, 'events.jsonl')

// What a session belongs to: its repository when it has a GitHub-style remote,
// and the folder it ran in (the git root when inside one). Two sessions share a
// project when either matches, so the app's per-session worktrees of one
// repository count together.
export type Project = { root?: string; repo?: string }
export const sameProject = (a: Project, b: Project) => (!!a.repo && a.repo === b.repo) || (!!a.root && a.root === b.root)

const norm = (p: string) => {
  let real = p
  try {
    real = fs.realpathSync.native(p)
  } catch {}
  return process.platform === 'win32' ? real.toLowerCase() : real
}
const gitRootOf = (dir: string) => {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d
    if (d === path.dirname(d)) return undefined
  }
}
// The repository's own .git folder: a worktree's .git is a file pointing into it.
const gitDirOf = (root: string) => {
  const dot = path.join(root, '.git')
  try {
    if (fs.statSync(dot).isDirectory()) return dot
    const link = /^gitdir: (.+)$/m.exec(fs.readFileSync(dot, 'utf8'))
    if (!link) return undefined
    const dir = path.resolve(root, link[1]!.trim())
    try {
      return path.resolve(dir, fs.readFileSync(path.join(dir, 'commondir'), 'utf8').trim())
    } catch {
      return dir
    }
  } catch {
    return undefined
  }
}
// "owner/name" from a remote URL, in either its https or its ssh spelling.
export const repoSlug = (url: string) => /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1]?.toLowerCase()
const repoOf = (root: string) => {
  const dir = gitDirOf(root)
  if (!dir) return undefined
  try {
    const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(fs.readFileSync(path.join(dir, 'config'), 'utf8'))
    return url ? repoSlug(url[1]!) : undefined
  } catch {
    return undefined
  }
}

// The project a folder belongs to. `repository` is what the runtime recorded for
// it, used when the folder (a cleaned-up worktree, say) is gone from disk.
export function projectOf(dir: string | undefined, home: string, repository?: string): Project | undefined {
  if (!dir) return undefined
  // The app's project-less chats each get a folder of their own under its home.
  if (norm(dir).startsWith(norm(path.join(home, 'chats')) + path.sep)) return undefined
  const root = gitRootOf(dir)
  const repo = (root && repoOf(root)) || repository?.toLowerCase() || undefined
  return { root: norm(root ?? dir), ...(repo ? { repo } : {}) }
}

// Turns a session file's lines into model calls, in order.
export function sessionParser(home: string) {
  let prompt = 0
  let project: Project | undefined
  const seen = new Set<string>()
  return {
    project: () => project,
    line(text: string): Call | undefined {
      // Most lines are messages and tool output: skip them unparsed.
      if (!text.includes('"session.usage_record"') && !text.includes('"session.start"') && !text.includes('"user.message"')) return undefined
      let o: any
      try {
        o = JSON.parse(text)
      } catch {
        return undefined
      }
      if (o?.type === 'session.start') {
        const context = o.data?.context
        project = projectOf(context?.gitRoot ?? context?.cwd, home, context?.repository)
        return undefined
      }
      // A prompt is everything the session does for one message from the user.
      if (o?.type === 'user.message') {
        if (!o.agentId) prompt += 1
        return undefined
      }
      // A checkpoint record replays history the file already holds.
      if (o?.type !== 'session.usage_record' || o.checkpoint) return undefined
      const u = o.data?.usage
      if (!u || typeof (u.responseModel ?? u.model) !== 'string') return undefined
      const id = u.accounting?.usageId ?? o.id
      if (id) {
        if (seen.has(id)) return undefined
        seen.add(id)
      }
      return { trace: String(prompt), endMs: Date.parse(o.timestamp) || Date.now(), usage: usageOf({ ...u, model: u.responseModel ?? u.model }) }
    },
  }
}

// Calls `onLines` with a file's lines: those it holds now, then each batch appended.
export function follow(file: string, onLines: (lines: string[]) => void) {
  let offset = 0
  let partial = ''
  const read = () => {
    let size: number
    try {
      size = fs.statSync(file).size
    } catch {
      return
    }
    if (size < offset) (offset = 0), (partial = '') // started over
    if (size === offset) return
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size - offset)
    fs.readSync(fd, buf, 0, buf.length, offset)
    fs.closeSync(fd)
    offset = size
    const lines = (partial + buf.toString('utf8')).split('\n')
    partial = lines.pop() ?? ''
    onLines(lines)
  }
  read()
  fs.watchFile(file, { interval: 1000 }, read)
  return () => fs.unwatchFile(file, read)
}

// The ledger: each session's project and total, kept in a file of our own so a
// session Copilot later deletes still counts toward its project.
type Entry = Project & { size: number; total: Usage }
export type Ledger = Record<string, Entry>

const readLedger = (file: string): Ledger => {
  try {
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'))
    return ledger && typeof ledger === 'object' ? ledger : {}
  } catch {
    return {}
  }
}

// Brings the ledger up to date with the sessions on disk and returns it. A
// session whose file has not grown is not read again. `skip` is a session the
// caller follows itself.
// ponytail: reads each changed session file whole; stream them if sessions reach hundreds of MB.
export function scan(home: string, ledgerFile: string, skip?: string): Ledger {
  const ledger = readLedger(ledgerFile)
  let ids: string[] = []
  try {
    ids = fs.readdirSync(path.join(home, 'session-state'))
  } catch {}
  let changed = false
  for (const id of ids) {
    if (id === skip) continue
    let text: string
    try {
      const size = fs.statSync(sessionFile(home, id)).size
      if (ledger[id]?.size === size) continue
      text = fs.readFileSync(sessionFile(home, id), 'utf8')
      const parser = sessionParser(home)
      let total = ZERO
      for (const line of text.split('\n')) {
        const call = parser.line(line)
        if (call) total = addUsage(total, call.usage)
      }
      ledger[id] = { ...parser.project(), size, total }
      changed = true
    } catch {
      continue
    }
  }
  if (changed) {
    try {
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
      // Another session's panel may write too: replace the file in one step.
      const tmp = `${ledgerFile}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ ...readLedger(ledgerFile), ...ledger }))
      fs.renameSync(tmp, ledgerFile)
    } catch {}
  }
  return ledger
}

// Every ledgered session of a project, added up; undefined when there is none.
export function projectTotal(ledger: Ledger, project: Project, skip?: string): { wh: number; usd: number } | undefined {
  const entries = Object.entries(ledger).filter(([id, e]) => id !== skip && sameProject(e, project))
  if (!entries.length) return undefined
  return entries.reduce((sum, [, e]) => ({ wh: sum.wh + (e.total?.wh ?? 0), usd: sum.usd + (e.total?.usd ?? 0) }), { wh: 0, usd: 0 })
}
