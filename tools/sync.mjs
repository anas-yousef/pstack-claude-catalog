#!/usr/bin/env node
// Refresh every vendored path from the pinned commits in sources.json.
// This tool owns every file except the ORIGINAL ones: it deletes the rest and
// rewrites them from the files git tracks at each pin, so a path dropped from
// sources.json disappears and a second run with the same pins writes the same
// bytes. Original files are never written or deleted.
//
//   node tools/sync.mjs                      fetch each source at its pin
//   node tools/sync.mjs --from <name>=<dir>  use a local checkout at the pin

import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHA = /^[0-9a-f]{40}$/
const ORIGINAL = ['.git/', 'README.md', 'NOTICE', 'LICENSE', 'sources.json', '.claude-plugin/', 'plugins/pstack-extras/.claude-plugin/', 'plugins/pstack-extras/skills/committed-browser-proof/', 'tools/']

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout
}

const isOriginal = (rel) => ORIGINAL.some((o) => (o.endsWith('/') ? rel.startsWith(o) : rel === o))

// A mapped path must already be in normal form: relative, no `.` or `..` segments, no empty segments.
function checkPath(rel, what) {
  const bare = rel.endsWith('/') ? rel.slice(0, -1) : rel
  if (!bare || path.posix.isAbsolute(rel) || path.posix.normalize(bare) !== bare || bare.split('/').some((s) => s === '.' || s === '..')) {
    fail(`${what} path is not a plain relative path: ${JSON.stringify(rel)}`)
  }
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

const args = process.argv.slice(2)
const from = {}
for (let i = 0; i < args.length; i += 1) {
  if (args[i] !== '--from' || !args[i + 1]?.includes('=')) fail('usage: node tools/sync.mjs [--from <name>=<checkout>]...')
  const [name, ...dir] = args[i + 1].split('=')
  from[name] = path.resolve(dir.join('='))
  i += 1
}

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
