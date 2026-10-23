#!/usr/bin/env node
// Refresh every vendored path from the pinned commits in sources.json.
// The vendored paths are owned by this tool: each one is replaced whole, and
// a second run with the same pins writes the same bytes. Original files
// (README.md, NOTICE, LICENSE, sources.json, .claude-plugin/, the
// pstack-extras manifest, tools/) are never written.
//
//   node tools/sync.mjs                    fetch each source at its pin
//   node tools/sync.mjs --from <name>=<dir>  use a clean local checkout at the pin

import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHA = /^[0-9a-f]{40}$/
const ORIGINAL = ['README.md', 'NOTICE', 'LICENSE', 'sources.json', '.claude-plugin/', 'plugins/pstack-extras/.claude-plugin/', 'tools/']

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout.trim()
}

function checkout(source, work, from) {
  if (from) {
    if (git(['rev-parse', 'HEAD'], from) !== source.commit) fail(`${from} is not at ${source.commit}`)
    if (git(['status', '--porcelain', '--untracked-files=all'], from)) fail(`${from} has uncommitted changes`)
    return from
  }
  const dir = path.join(work, source.name)
  mkdirSync(dir, { recursive: true })
  git(['init', '-q'], dir)
  git(['fetch', '-q', '--depth', '1', `${source.repo}.git`, source.commit], dir)
  git(['checkout', '-q', 'FETCH_HEAD'], dir)
  if (git(['rev-parse', 'HEAD'], dir) !== source.commit) fail(`${source.name} did not check out ${source.commit}`)
  return dir
}

// Copies keep the executable bit and nothing else, so file modes do not depend on the umask.
function normalizeModes(target) {
  const stat = lstatSync(target)
  if (stat.isSymbolicLink()) fail(`refusing a symlink: ${target}`)
  if (stat.isDirectory()) {
    chmodSync(target, 0o755)
    for (const name of readdirSync(target)) normalizeModes(path.join(target, name))
  } else {
    chmodSync(target, (stat.mode & 0o111) !== 0 ? 0o755 : 0o644)
  }
}

const args = process.argv.slice(2)
const from = {}
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--from' || !args[i + 1]?.includes('=')) fail('usage: node tools/sync.mjs [--from <name>=<checkout>]...')
  const [name, ...dir] = args[i + 1].split('=')
  from[name] = path.resolve(dir.join('='))
  i += 1
}

const { sources } = JSON.parse(readFileSync(path.join(ROOT, 'sources.json'), 'utf8'))
const dests = new Set()
for (const source of sources) {
  if (!SHA.test(source.commit)) fail(`${source.name} needs a 40-character commit`)
  for (const dest of Object.values(source.paths)) {
    if (dest.split('/').includes('..') || path.isAbsolute(dest)) fail(`unsafe path ${dest}`)
    if (ORIGINAL.some((o) => (o.endsWith('/') ? dest.startsWith(o) || o.startsWith(dest) : dest === o))) fail(`refusing to write original file ${dest}`)
    if (dests.has(dest)) fail(`two sources write ${dest}`)
    dests.add(dest)
  }
}

const work = mkdtempSync(path.join(tmpdir(), 'pstack-claude-catalog-'))
try {
  for (const source of sources) {
    const dir = checkout(source, work, from[source.name])
    for (const [upstream, dest] of Object.entries(source.paths)) {
      const src = path.join(dir, upstream)
      if (!existsSync(src)) fail(`${source.name} has no ${upstream} at ${source.commit}`)
      const target = path.join(ROOT, dest)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(path.dirname(target), { recursive: true })
      cpSync(src, target, { recursive: true, verbatimSymlinks: true, filter: (p) => path.basename(p) !== '.git' })
      normalizeModes(target)
    }
    process.stdout.write(`${source.name} ${source.commit}\n`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
