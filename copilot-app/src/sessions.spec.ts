import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

import { start, tally } from '../../vscode/src/copilotLog.ts'
import { saveSession } from './ledger.ts'
import { follow, followSession, projectOf, projectTotal, repoSlug, sameProject, scan, sessionFile, sessionParser } from './sessions.ts'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-sessions-')))
const line = (type: string, data: object, extra: object = {}) => JSON.stringify({ type, data, id: Math.random().toString(16).slice(2), timestamp: '2026-11-17T10:00:00.000Z', ...extra })
// Shaped like the records the Copilot runtime saves (copilotVersion 1.0.108).
const usage = (model: string, input: number, output: number, read: number, nano: number, extra: object = {}) =>
  line('session.usage_record', { usage: { model, responseModel: model, inputTokens: input, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: 0, copilotUsage: { totalNanoAiu: nano }, accounting: { usageId: `${model}-${input}-${nano}` } } }, extra)
const session = (cwd: string, ...lines: string[]) => [line('session.start', { context: { cwd } }), ...lines].join('\n') + '\n'
const write = (home: string, id: string, text: string) => {
  fs.mkdirSync(path.dirname(sessionFile(home, id)), { recursive: true })
  fs.writeFileSync(sessionFile(home, id), text)
}

test('a saved session becomes model calls, subagents included, grouped by prompt', () => {
  const home = tmp()
  const parser = sessionParser(home)
  const text = session(
    home,
    line('user.message', { content: 'find the bug' }),
    usage('gpt-6-luna', 15198, 242, 0, 202_067_500),
    // The subagent's own prompt and calls carry its agentId and belong to the same user prompt.
    line('user.message', { content: 'explore' }, { agentId: 'sub-1' }),
    usage('mai-code-1.1-flash', 3814, 135, 0, 92_480_000, { agentId: 'sub-1' }),
    usage('mai-code-1.1-flash', 3964, 8, 3840, 11_120_000, { agentId: 'sub-1' }),
    usage('gpt-6-luna', 15454, 67, 15195, 21_775_000),
    // The same record again, and a checkpoint replay, add nothing.
    usage('gpt-6-luna', 15454, 67, 15195, 21_775_000),
    usage('gpt-6-luna', 9, 9, 0, 9, { checkpoint: true }),
    line('assistant.message', { content: 'a reply that mentions "session.usage_record" in passing' }),
    line('user.message', { content: 'thanks' }),
    usage('gpt-6-luna', 15600, 20, 15454, 5_000_000),
    'not json',
  )
  let t = start()
  for (const l of text.split('\n')) {
    const call = parser.line(l)
    if (call) t = tally(t, call)
  }
  assert.equal(t.billed, 5)
  assert.equal(t.prompts.length, 2)
  // Copilot's charges: (202,067,500 + 92,480,000 + 11,120,000 + 21,775,000 + 5,000,000) nano credits at $0.01 per 1e9.
  assert.equal(Math.round(t.total.usd * 1e11), 332_442_500)
  assert.equal(Math.round(t.prompts[0]!.usd * 1e11), 327_442_500)
  // Input counts include cache reads, which are taken back out.
  assert.equal(t.total.cacheRead, 3840 + 15195 + 15454)
  assert.equal(t.total.input, 15198 + 3814 + (3964 - 3840) + (15454 - 15195) + (15600 - 15454))
  assert.deepEqual(parser.project(), { root: home })
})

test('a project is its repository, or else its folder', () => {
  const home = tmp()
  const repo = path.join(tmp(), 'shop')
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:Acme/Shop.git\n\tfetch = +refs/heads/*\n')
  assert.deepEqual(projectOf(path.join(repo, 'src', 'deep'), home), { root: repo, repo: 'acme/shop' })

  // A worktree's .git is a file pointing into the repository: same repo, other folder.
  const tree = path.join(tmp(), 'shop-tree')
  fs.mkdirSync(path.join(repo, '.git', 'worktrees', 't1'), { recursive: true })
  fs.writeFileSync(path.join(repo, '.git', 'worktrees', 't1', 'commondir'), '../..\n')
  fs.mkdirSync(tree)
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 't1')}\n`)
  const worktree = projectOf(tree, home)!
  assert.equal(worktree.repo, 'acme/shop')
  assert.ok(sameProject(worktree, projectOf(repo, home)!))

  // A folder that is gone keeps the repository the runtime recorded for it.
  assert.deepEqual(projectOf('/no/such/worktree', home, 'Acme/Shop'), { root: '/no/such/worktree', repo: 'acme/shop' })
  const plain = tmp()
  assert.deepEqual(projectOf(plain, home), { root: plain })
  assert.ok(!sameProject(projectOf(plain, home)!, projectOf(repo, home)!))
  // The app's project-less chats have no project.
  fs.mkdirSync(path.join(home, 'chats', '2026-11-17', 'a-chat'), { recursive: true })
  assert.equal(projectOf(path.join(home, 'chats', '2026-11-17', 'a-chat'), home), undefined)
  assert.equal(projectOf(undefined, home), undefined)

  assert.equal(repoSlug('https://github.com/Acme/Shop.git'), 'acme/shop')
  assert.equal(repoSlug('https://github.com/acme/shop'), 'acme/shop')
  assert.equal(repoSlug('ssh://git@github.example.com:22/acme/shop.git'), 'acme/shop')
})

test('the project total adds up its sessions, and keeps one Copilot deleted', () => {
  const home = tmp()
  const ledger = path.join(tmp(), 'nested', 'ledger.json')
  const shop = tmp()
  const other = tmp()
  write(home, 'a', session(shop, usage('gpt-6-luna', 1000, 100, 0, 1_000_000_000)))
  write(home, 'b', session(shop, usage('gpt-6-luna', 1000, 100, 0, 2_000_000_000)))
  write(home, 'c', session(other, usage('gpt-6-luna', 1000, 100, 0, 50_000_000_000)))
  const mine = projectOf(shop, home)!

  const first = projectTotal(scan(home, ledger), mine)!
  assert.equal(Math.round(first.usd * 100), 3)
  assert.ok(first.wh > 0)
  // The caller's own session is left out when it adds that one itself.
  assert.equal(Math.round(projectTotal(scan(home, ledger), mine, 'b')!.usd * 100), 1)
  assert.equal(projectTotal(scan(home, ledger), projectOf(tmp(), home)!), undefined)

  // Session b grows, session a is deleted by Copilot: a still counts from the ledger.
  fs.appendFileSync(sessionFile(home, 'b'), usage('gpt-6-luna', 1000, 100, 0, 4_000_000_000) + '\n')
  fs.rmSync(path.dirname(sessionFile(home, 'a')), { recursive: true })
  assert.equal(Math.round(projectTotal(scan(home, ledger), mine)!.usd * 100), 7)
})

test('follow reads what a file holds, then what is appended, whole lines only', async () => {
  const file = path.join(tmp(), 'events.jsonl')
  fs.writeFileSync(file, 'one\ntwo\nthr')
  const got: string[] = []
  const stop = follow(file, lines => got.push(...lines))
  assert.deepEqual(got, ['one', 'two'])
  fs.appendFileSync(file, 'ee\nfour\n')
  await new Promise(resolve => setTimeout(resolve, 2200))
  stop()
  assert.deepEqual(got, ['one', 'two', 'three', 'four'])
})

test('the active panel saves its last usage before Copilot prunes the session', { timeout: 10000 }, async t => {
  const home = tmp()
  const ledger = path.join(tmp(), 'ledger.json')
  const shop = tmp()
  const mine = projectOf(shop, home)!
  write(home, 'a', session(shop, usage('gpt-6-luna', 1000, 100, 0, 2_000_000_000)))
  let finished!: () => void
  const observed = new Promise<void>(resolve => { finished = resolve })
  const stop = followSession(home, ledger, 'a', next => {
    if (next.billed === 2) finished()
  })
  t.after(stop)
  fs.appendFileSync(sessionFile(home, 'a'), usage('gpt-6-luna', 1000, 100, 0, 1_000_000_000) + '\n')
  await observed
  stop()
  fs.rmSync(path.dirname(sessionFile(home, 'a')), { recursive: true })

  write(home, 'b', session(shop, usage('gpt-6-luna', 1000, 100, 0, 2_000_000_000)))
  t.after(followSession(home, ledger, 'b', next => {
    const others = projectTotal(scan(home, ledger), mine, 'b')
    assert.equal(Math.round(((others?.usd ?? 0) + next.total.usd) * 100), 5)
  }))
  assert.equal(Math.round(projectTotal(scan(home, ledger), mine)!.usd * 100), 5)
})

test('a late writer preserves newer usage and the other sessions already committed', () => {
  const home = tmp()
  const ledger = path.join(tmp(), 'ledger.json')
  const shop = tmp()
  write(home, 'a', session(shop, usage('gpt-6-luna', 1000, 100, 0, 1_000_000_000)))
  const stale = scan(home, ledger).a!
  assert.ok(stale.revision)

  fs.appendFileSync(sessionFile(home, 'a'), usage('gpt-6-luna', 1000, 100, 0, 2_000_000_000) + '\n')
  write(home, 'b', session(shop, usage('gpt-6-luna', 1000, 100, 0, 4_000_000_000)))
  scan(home, ledger)
  fs.rmSync(path.join(home, 'session-state'), { recursive: true })

  // The first writer finishes publishing the revision it read before the second scan.
  const published = saveSession(ledger, 'a', { ...stale, revision: stale.revision })
  assert.equal(Math.round(published.total.usd * 100), 3)
  const kept = scan(home, ledger)
  assert.equal(Math.round(kept.a!.total.usd * 100), 3)
  assert.equal(Math.round(kept.b!.total.usd * 100), 4)
})

test('preserves legacy entries for deleted sessions and can read past a damaged legacy ledger', () => {
  const home = tmp()
  const ledger = path.join(tmp(), 'ledger.json')
  const shop = tmp()
  write(home, 'live', session(shop, usage('gpt-6-luna', 1000, 100, 0, 1_000_000_000)))
  const mine = projectOf(shop, home)!
  const entry = { ...mine, size: 100, total: { ...start().total, usd: 0.02 } }
  fs.writeFileSync(ledger, JSON.stringify({ deleted: entry }))
  assert.equal(Math.round(projectTotal(scan(home, ledger), mine)!.usd * 100), 3)
  fs.writeFileSync(ledger, 'not json')
  assert.equal(Math.round(projectTotal(scan(home, ledger), mine)!.usd * 100), 1)
})
