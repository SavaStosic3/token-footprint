import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Usage } from '../../types/index.d.ts'
import type { Project } from './sessions.ts'

type Entry = Project & { size: number; total: Usage; revision?: string }
export type Ledger = Record<string, Entry>

// File modification time orders rewrites, including truncations. The byte offset
// orders appends on filesystems where successive writes have the same timestamp.
export const revisionOf = (mtimeNs: bigint, size: number) =>
  mtimeNs.toString().padStart(20, '0') + '-' + size.toString().padStart(16, '0')

const revisions = (dir: string) => fs.readdirSync(dir).filter(name => /^\d{20}-\d{16}\.json$/.test(name)).sort()

function readLatest(dir: string): Entry | undefined {
  for (;;) {
    const latest = revisions(dir).at(-1)
    if (!latest) return undefined
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf8'))
    } catch (error) {
      // A writer may have pruned this revision since readdir.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

// Publish each observed revision independently. A delayed writer can never
// replace a newer revision, even if the source was deleted in the meantime.
export function saveSession(file: string, id: string, entry: Entry & { revision: string }): Entry {
  if (!id || id === '.' || id === '..' || path.basename(id) !== id) return entry
  const dir = path.join(file + '.d', id)
  const tmp = path.join(dir, randomUUID() + '.tmp')
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(entry))
    fs.renameSync(tmp, path.join(dir, entry.revision + '.json'))
    // Publish before pruning. Every removed revision has a newer durable one.
    const files = revisions(dir)
    for (const old of files.slice(0, -1)) fs.rmSync(path.join(dir, old), { force: true })
    if (files.at(-1) !== entry.revision + '.json') return readLatest(dir) ?? entry
  } catch {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {}
  }
  return entry
}

export function readLedger(file: string): Ledger {
  // Older panels stored all sessions together. Keep entries for pruned sessions
  // even if their only remaining copy is in the original ledger.
  const ledger: Ledger = Object.create(null)
  try {
    const legacy = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) Object.assign(ledger, legacy)
  } catch {}
  const root = file + '.d'
  let ids: string[]
  try {
    ids = fs.readdirSync(root)
  } catch {
    return ledger
  }
  for (const id of ids) {
    try {
      const entry = readLatest(path.join(root, id))
      if (entry) ledger[id] = entry
    } catch {}
  }
  return ledger
}
