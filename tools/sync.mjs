#!/usr/bin/env node
// Refresh every vendored path from the pinned commits in sources.json.
// Without --check, this tool owns every file except the ORIGINAL ones: it
// deletes the rest and rewrites them from the files git tracks at each pin,
// so a path dropped from sources.json disappears and a second run with the
// same pins writes the same bytes. Original files are never written or deleted.
//
//   node tools/sync.mjs                      fetch each source at its pin and write the tree
//   node tools/sync.mjs --check              compare each pin to upstream and write nothing
//   node tools/sync.mjs --outdated           same as --check
//   node tools/sync.mjs --from <name>=<dir>  use a local checkout at the pin
//
// --check exits 0 when every mapped path matches its pin, including when the
// remote tip has moved and those paths have not. It exits non-zero when a
// mapped path differs or a remote cannot be read.

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHA = /^[0-9a-f]{40}$/
const USAGE = 'usage: node tools/sync.mjs [--check] [--outdated] [--from <name>=<checkout>]...'
const ORIGINAL = ['.git/', 'README.md', 'NOTICE', 'LICENSE', 'sources.json', '.claude-plugin/', 'plugins/pstack-extras/.claude-plugin/', 'plugins/pstack-extras/skills/committed-browser-proof/', 'plugins/pstack-extras/skills/local-supabase/', 'tools/']

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function gitResult(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

function git(args, cwd) {
  const result = gitResult(args, cwd)
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  return result.stdout
}

function commandError(result, args) {
  return oneLine(result.stderr || result.stdout || result.error?.message) || `git ${args.join(' ')} failed`
}

const isOriginal = (rel) => ORIGINAL.some((o) => (o.endsWith('/') ? rel.startsWith(o) : rel === o))

// A mapped path must already be in normal form: relative, no `.` or `..` segments, no empty segments.
function checkPath(rel, what) {
  const bare = rel.endsWith('/') ? rel.slice(0, -1) : rel
  if (!bare || path.posix.isAbsolute(rel) || path.posix.normalize(bare) !== bare || bare.split('/').some((s) => s === '.' || s === '..')) {
    fail(`${what} path is not a plain relative path: ${JSON.stringify(rel)}`)
  }
}

function parseArgs(args) {
  let check = false
  const from = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--check' || arg === '--outdated') {
      check = true
      continue
    }
    if (arg === '--from') {
      const value = args[i + 1]
      if (!value?.includes('=')) fail(USAGE)
      const [name, ...dir] = value.split('=')
      from[name] = path.resolve(dir.join('='))
      i += 1
      continue
    }
    fail(USAGE)
  }
  if (check && Object.keys(from).length > 0) fail('--check rejects --from')
  return { check, from }
}

function checkout(source, work, from) {
  if (from) {
    if (git(['rev-parse', 'HEAD'], from).trim() !== source.commit) fail(`${from} is not at ${source.commit}`)
    return from
  }
  const dir = path.join(work, source.name)
  mkdirSync(dir, { recursive: true })
  git(['init', '-q'], dir)
  git(['fetch', '-q', '--depth', '1', `${source.repo}.git`, source.commit], dir)
  git(['checkout', '-q', 'FETCH_HEAD'], dir)
  if (git(['rev-parse', 'HEAD'], dir).trim() !== source.commit) fail(`${source.name} did not check out ${source.commit}`)
  return dir
}

// The committed bytes, never the working tree, so local edits in a --from checkout cannot leak in.
function blob(dir, commit, file) {
  const result = spawnSync('git', ['show', `${commit}:${file}`], { cwd: dir, maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) fail(`git show ${commit}:${file} failed`)
  return result.stdout
}

// Files as git tracks them at the pinned commit: [path, mode, type]. Ignored or untracked files never count.
function trackedFiles(dir, commit) {
  const out = []
  for (const line of git(['ls-tree', '-r', '-z', '--full-tree', commit], dir).split('\0')) {
    if (!line) continue
    const [meta, file] = line.split('\t')
    const [mode, type] = meta.split(' ')
    out.push([file, mode, type])
  }
  return out
}

function remoteHead(repo) {
  const args = ['ls-remote', '--symref', `${repo}.git`, 'HEAD']
  const result = gitResult(args)
  if (result.status !== 0) return { error: commandError(result, args) }
  const tip = /^([0-9a-f]{40})\tHEAD$/m.exec(result.stdout || '')
  if (!tip) return { error: `no HEAD at ${repo}` }
  const symref = /^ref: (\S+)\tHEAD$/m.exec(result.stdout || '')
  const ref = symref ? symref[1] : 'HEAD'
  if (ref !== 'HEAD' && !ref.startsWith('refs/')) return { error: `unexpected HEAD ref at ${repo}` }
  return { tip: tip[1], ref }
}

function fetchPair(dir, repo, pin, ref) {
  mkdirSync(dir, { recursive: true })
  const init = ['init', '-q']
  let result = gitResult(init, dir)
  if (result.status !== 0) return { error: commandError(result, init) }
  const args = ['fetch', '-q', '--depth', '1', `${repo}.git`, `${pin}:refs/tmp/pin`, `${ref}:refs/tmp/tip`]
  result = gitResult(args, dir)
  if (result.status !== 0) return { error: commandError(result, args) }
  return {}
}

function rev(dir, ref) {
  const args = ['rev-parse', ref]
  const result = gitResult(args, dir)
  if (result.status !== 0) return { error: commandError(result, args) }
  const sha = (result.stdout || '').trim()
  if (!SHA.test(sha)) return { error: `git rev-parse ${ref} returned ${JSON.stringify(sha)}` }
  return { sha }
}

function mappedChanges(dir, source) {
  const changes = []
  for (const upstream of Object.keys(source.paths)) {
    const spec = upstream.endsWith('/') ? upstream.slice(0, -1) : upstream
    const atPin = gitResult(['--literal-pathspecs', 'ls-tree', '-r', '--name-only', 'refs/tmp/pin', '--', spec], dir)
    if (atPin.status !== 0) return { error: commandError(atPin, ['ls-tree', spec]) }
    if (!(atPin.stdout || '').trim()) return { error: `${source.name} has no ${upstream} at ${source.commit}` }
    const raw = gitResult(['--literal-pathspecs', 'diff', '--raw', '--no-renames', '--no-abbrev', 'refs/tmp/pin', 'refs/tmp/tip', '--', spec], dir)
    if (raw.status !== 0) return { error: commandError(raw, ['diff', spec]) }
    const count = (raw.stdout || '').split('\n').filter(Boolean).length
    if (count > 0) changes.push([upstream, count])
  }
  return { changes }
}

function inspect(source, dir) {
  const head = remoteHead(source.repo)
  if (head.error) return { status: 'error', message: head.error }
  if (head.tip === source.commit) return { status: 'current' }
  const fetched = fetchPair(dir, source.repo, source.commit, head.ref)
  if (fetched.error) return { status: 'error', message: fetched.error }
  const pin = rev(dir, 'refs/tmp/pin')
  if (pin.error) return { status: 'error', message: pin.error }
  if (pin.sha !== source.commit) return { status: 'error', message: `${source.name} did not fetch ${source.commit}` }
  const tip = rev(dir, 'refs/tmp/tip')
  if (tip.error) return { status: 'error', message: tip.error }
  if (tip.sha === source.commit) return { status: 'current' }
  const diff = mappedChanges(dir, source)
  if (diff.error) return { status: 'error', message: diff.error }
  if (diff.changes.length === 0) return { status: 'unchanged', tip: tip.sha }
  return { status: 'outdated', tip: tip.sha, changes: diff.changes }
}

function printRow(source, row) {
  if (row.status === 'current') {
    process.stdout.write(`${source.name} current ${source.commit}\n`)
    return 0
  }
  if (row.status === 'unchanged') {
    process.stdout.write(`${source.name} unchanged ${source.commit} tip ${row.tip}\n`)
    return 0
  }
  if (row.status === 'outdated') {
    process.stdout.write(`${source.name} outdated ${source.commit} tip ${row.tip}\n`)
    for (const [upstream, count] of row.changes) process.stdout.write(`  ${upstream} ${count}\n`)
    return 1
  }
  process.stdout.write(`${source.name} error ${row.message}\n`)
  return 1
}

function runCheck(sources) {
  const work = mkdtempSync(path.join(tmpdir(), 'pstack-claude-catalog-check-'))
  let code = 0
  try {
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]
      const row = inspect(source, path.join(work, String(index)))
      code = Math.max(code, printRow(source, row))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return code
}

function walk(dir, prefix, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!isOriginal(`${rel}/`)) walk(path.join(dir, entry.name), rel, out)
    } else out.push(rel)
  }
  return out
}

function pruneEmptyDirs(dir, rel) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory() && !isOriginal(`${childRel}/`)) pruneEmptyDirs(path.join(dir, entry.name), childRel)
  }
  if (rel && readdirSync(dir).length === 0) rmdirSync(dir)
}

function writeTree(sources, from) {
  // Plan every vendored file before touching the tree.
  const work = mkdtempSync(path.join(tmpdir(), 'pstack-claude-catalog-'))
  const plan = new Map()
  try {
    for (const source of sources) {
      const dir = checkout(source, work, from[source.name])
      const files = trackedFiles(dir, source.commit)
      for (const [upstream, dest] of Object.entries(source.paths)) {
        const matched = files.filter(([file]) => (upstream.endsWith('/') ? file.startsWith(upstream) : file === upstream))
        if (matched.length === 0) fail(`${source.name} has no ${upstream} at ${source.commit}`)
        for (const [file, mode, type] of matched) {
          if (type !== 'blob' || mode === '120000') fail(`refusing ${mode === '120000' ? 'a symlink' : type} ${file} at ${source.commit}`)
          const executable = mode === '100755'
          const rel = upstream.endsWith('/') ? dest + file.slice(upstream.length) : dest
          if (plan.has(rel)) fail(`two sources write ${rel}`)
          plan.set(rel, { bytes: blob(dir, source.commit, file), executable })
        }
      }
      process.stdout.write(`${source.name} ${source.commit}\n`)
    }
    for (const rel of walk(ROOT, '', [])) if (!isOriginal(rel)) rmSync(path.join(ROOT, rel))
    for (const [rel, entry] of plan) {
      const target = path.join(ROOT, rel)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, entry.bytes)
      chmodSync(target, entry.executable ? 0o755 : 0o644)
    }
    pruneEmptyDirs(ROOT, '')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const { check, from } = parseArgs(process.argv.slice(2))
const { sources } = JSON.parse(readFileSync(path.join(ROOT, 'sources.json'), 'utf8'))
for (const source of sources) {
  if (!SHA.test(source.commit)) fail(`${source.name} needs a 40-character commit`)
  for (const [upstream, dest] of Object.entries(source.paths)) {
    checkPath(upstream, `${source.name} upstream`)
    checkPath(dest, `${source.name} vendored`)
    if (upstream.endsWith('/') !== dest.endsWith('/')) fail(`${source.name}: ${upstream} and ${dest} must both be directories or both files`)
    if (isOriginal(dest) || ORIGINAL.some((o) => o.startsWith(dest))) fail(`refusing to write original path ${dest}`)
  }
}

if (check) {
  const code = runCheck(sources)
  if (code !== 0) process.exit(code)
} else {
  writeTree(sources, from)
}
