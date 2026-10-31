import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const SYNC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sync.mjs')

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

function snapshot(root, prefix = '') {
  const out = {}
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const abs = path.join(root, rel)
    if (entry.isDirectory()) Object.assign(out, snapshot(root, rel))
    else {
      const body = readFileSync(abs)
      out[rel] = `${statSync(abs).mode & 0o777}:${createHash('sha256').update(body).digest('hex')}`
    }
  }
  return out
}

function catalog(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'catalog-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'tools'), { recursive: true })
  writeFileSync(path.join(root, 'tools', 'sync.mjs'), readFileSync(SYNC))
  writeFileSync(path.join(root, 'README.md'), 'readme\n')
  writeFileSync(path.join(root, 'NOTICE'), 'notice\n')
  writeFileSync(path.join(root, 'LICENSE'), 'license\n')
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), '{}\n')
  const proof = path.join(root, 'plugins', 'pstack-extras', 'skills', 'committed-browser-proof')
  mkdirSync(proof, { recursive: true })
  writeFileSync(path.join(proof, 'SKILL.md'), 'proof-sentinel\n')
  writeFileSync(path.join(proof, 'notes.txt'), 'keep-me\n')
  mkdirSync(path.join(root, 'plugins', 'pstack-extras', '.claude-plugin'), { recursive: true })
  mkdirSync(path.join(root, 'plugins', 'pstack-extras', '.codex-plugin'), { recursive: true })
  writeFileSync(path.join(root, 'plugins', 'pstack-extras', '.codex-plugin', 'plugin.json'), 'codex-manifest-sentinel\n')
  mkdirSync(path.join(root, 'profiles'), { recursive: true })
  writeFileSync(path.join(root, 'profiles', 'lean.md'), 'profile-sentinel\n')
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  writeFileSync(path.join(root, 'scripts', 'setup-pstack-claude.mjs'), 'adopter-sentinel\n')
  writeFileSync(path.join(root, 'stray.txt'), 'stray\n')
  return root
}

function upstream(t) {
  const work = mkdtempSync(path.join(tmpdir(), 'upstream-'))
  t.after(() => rmSync(work, { recursive: true, force: true }))
  const bare = path.join(work, 'upstream.git')
  const src = path.join(work, 'src')
  git(['init', '--bare', '-q', '-b', 'main', bare])
  git(['clone', '-q', bare, src])
  git(['config', 'user.email', 'test@example.com'], src)
  git(['config', 'user.name', 'test'], src)
  return { repo: path.join(work, 'upstream'), src }
}

function commit(src, message) {
  git(['add', '.'], src)
  git(['commit', '-q', '-m', message], src)
  return git(['rev-parse', 'HEAD'], src).trim()
}

function push(src) {
  git(['push', '-q', 'origin', 'HEAD:main'], src)
}

function writeSources(root, sources) {
  writeFileSync(path.join(root, 'sources.json'), JSON.stringify({ sources }, null, 2))
}

function run(root, args) {
  return spawnSync(process.execPath, [path.join(root, 'tools', 'sync.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

function seedFoo(src, body) {
  const dir = path.join(src, 'skills', 'foo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'SKILL.md'), body)
  writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\n')
  chmodSync(path.join(dir, 'run.sh'), 0o755)
  git(['add', '--chmod=+x', 'skills/foo/run.sh'], src)
}

test('--check reports current and leaves the tree untouched', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const before = snapshot(root)
  const result = run(root, ['--check'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `local current ${pin}\n`)
  assert.deepEqual(snapshot(root), before)
})

test('--check reports unchanged when the tip moves off the mapped paths', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  writeFileSync(path.join(up.src, 'notes.txt'), 'noise\n')
  const tip = commit(up.src, 'noise')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const before = snapshot(root)
  const result = run(root, ['--check'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `local unchanged ${pin} tip ${tip}\n`)
  assert.deepEqual(snapshot(root), before)
})

test('--check ignores a sibling prefix of a mapped directory', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  mkdirSync(path.join(up.src, 'skills', 'foo-extra'), { recursive: true })
  writeFileSync(path.join(up.src, 'skills', 'foo-extra', 'SKILL.md'), 'extra\n')
  const tip = commit(up.src, 'sibling')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const result = run(root, ['--check'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `local unchanged ${pin} tip ${tip}\n`)
})

test('--check exits non-zero and names each mapped path that differs', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  writeFileSync(path.join(up.src, 'LICENSE'), 'mit\n')
  const pin = commit(up.src, 'pin')
  writeFileSync(path.join(up.src, 'skills', 'foo', 'SKILL.md'), 'v2\n')
  writeFileSync(path.join(up.src, 'skills', 'foo', 'extra.md'), 'new\n')
  writeFileSync(path.join(up.src, 'LICENSE'), 'mit-2\n')
  const tip = commit(up.src, 'tip')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: {
      'skills/foo/': 'plugins/pstack-extras/skills/foo/',
      LICENSE: 'third-party/local/LICENSE',
    },
  }])
  const before = snapshot(root)
  const result = run(root, ['--check'])
  assert.equal(result.status, 1)
  assert.equal(result.stdout, `local outdated ${pin} tip ${tip}\n  skills/foo/ 2\n  LICENSE 1\n`)
  assert.deepEqual(snapshot(root), before)
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/skills/committed-browser-proof/SKILL.md'), 'utf8'), 'proof-sentinel\n')
})

test('--outdated matches --check', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  writeFileSync(path.join(up.src, 'skills', 'foo', 'SKILL.md'), 'v2\n')
  const tip = commit(up.src, 'tip')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const check = run(root, ['--check'])
  const outdated = run(root, ['--outdated'])
  assert.equal(outdated.status, check.status)
  assert.equal(outdated.stdout, check.stdout)
  assert.equal(outdated.stdout, `local outdated ${pin} tip ${tip}\n  skills/foo/ 1\n`)
})

test('--check treats a mode-only change and a deletion as outdated', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  chmodSync(path.join(up.src, 'skills', 'foo', 'run.sh'), 0o644)
  git(['add', '--chmod=-x', 'skills/foo/run.sh'], up.src)
  const modeTip = commit(up.src, 'mode')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const mode = run(root, ['--check'])
  assert.equal(mode.status, 1)
  assert.equal(mode.stdout, `local outdated ${pin} tip ${modeTip}\n  skills/foo/ 1\n`)

  git(['rm', '-q', 'skills/foo/SKILL.md'], up.src)
  const deleted = commit(up.src, 'delete')
  push(up.src)
  const gone = run(root, ['--check'])
  assert.equal(gone.status, 1)
  assert.equal(gone.stdout, `local outdated ${pin} tip ${deleted}\n  skills/foo/ 2\n`)
})

test('--check prints every source and fails when any mapped path differs', (t) => {
  const root = catalog(t)
  const first = upstream(t)
  const second = upstream(t)
  seedFoo(first.src, 'v1\n')
  const pin1 = commit(first.src, 'pin')
  push(first.src)
  seedFoo(second.src, 'v1\n')
  const pin2 = commit(second.src, 'pin')
  writeFileSync(path.join(second.src, 'skills', 'foo', 'SKILL.md'), 'v2\n')
  const tip2 = commit(second.src, 'tip')
  push(second.src)
  writeSources(root, [
    {
      name: 'first',
      repo: first.repo,
      commit: pin1,
      paths: { 'skills/foo/': 'plugins/pstack-extras/skills/first/' },
    },
    {
      name: 'second',
      repo: second.repo,
      commit: pin2,
      paths: { 'skills/foo/': 'plugins/pstack-extras/skills/second/' },
    },
  ])
  const result = run(root, ['--check'])
  assert.equal(result.status, 1)
  assert.equal(result.stdout, `first current ${pin1}\nsecond outdated ${pin2} tip ${tip2}\n  skills/foo/ 1\n`)
})

test('--check reports a source whose remote cannot be read', (t) => {
  const root = catalog(t)
  writeSources(root, [{
    name: 'missing',
    repo: path.join(root, 'no-such-repo'),
    commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const before = snapshot(root)
  const result = run(root, ['--check'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /^missing error .+\n$/)
  assert.deepEqual(snapshot(root), before)
})

test('--check rejects --from and an unknown flag without writing', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const before = snapshot(root)
  const combined = run(root, ['--check', '--from', `local=${up.src}`])
  assert.notEqual(combined.status, 0)
  assert.match(combined.stderr, /--check rejects --from/)
  assert.equal(combined.stdout, '')
  const unknown = run(root, ['--write-all'])
  assert.notEqual(unknown.status, 0)
  assert.match(unknown.stderr, /usage:/)
  assert.deepEqual(snapshot(root), before)
})

test('--check refuses a mapping onto an original path', (t) => {
  const root = catalog(t)
  writeSources(root, [{
    name: 'local',
    repo: path.join(root, 'upstream'),
    commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    paths: {
      'skills/foo/': 'plugins/pstack-extras/skills/committed-browser-proof/',
    },
  }])
  const before = snapshot(root)
  const result = run(root, ['--check'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /refusing to write original path/)
  assert.deepEqual(snapshot(root), before)
})

test('a write at the pin is idempotent and keeps original files', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  writeFileSync(path.join(up.src, 'skills', 'foo', 'SKILL.md'), 'v2\n')
  commit(up.src, 'tip')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const first = run(root, [])
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.stdout, `local ${pin}\n`)
  const skill = path.join(root, 'plugins/pstack-extras/skills/foo/SKILL.md')
  const runSh = path.join(root, 'plugins/pstack-extras/skills/foo/run.sh')
  assert.equal(readFileSync(skill, 'utf8'), 'v1\n')
  assert.equal(statSync(runSh).mode & 0o777, 0o755)
  assert.equal(exists(root, 'stray.txt'), false)
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/skills/committed-browser-proof/SKILL.md'), 'utf8'), 'proof-sentinel\n')
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/skills/committed-browser-proof/notes.txt'), 'utf8'), 'keep-me\n')
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/.codex-plugin/plugin.json'), 'utf8'), 'codex-manifest-sentinel\n')
  assert.equal(readFileSync(path.join(root, 'profiles/lean.md'), 'utf8'), 'profile-sentinel\n')
  assert.equal(readFileSync(path.join(root, 'scripts/setup-pstack-claude.mjs'), 'utf8'), 'adopter-sentinel\n')
  const after = snapshot(root)
  const second = run(root, [])
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual(snapshot(root), after)
})

test('--from writes the pin and rejects a checkout that is not the pin', (t) => {
  const root = catalog(t)
  const up = upstream(t)
  seedFoo(up.src, 'v1\n')
  const pin = commit(up.src, 'pin')
  writeFileSync(path.join(up.src, 'skills', 'foo', 'SKILL.md'), 'v2\n')
  commit(up.src, 'tip')
  push(up.src)
  writeSources(root, [{
    name: 'local',
    repo: up.repo,
    commit: pin,
    paths: { 'skills/foo/': 'plugins/pstack-extras/skills/foo/' },
  }])
  const wrong = run(root, ['--from', `local=${up.src}`])
  assert.notEqual(wrong.status, 0)
  assert.equal(exists(root, 'plugins/pstack-extras/skills/foo/SKILL.md'), false)
  assert.equal(readFileSync(path.join(root, 'stray.txt'), 'utf8'), 'stray\n')
  git(['checkout', '-q', pin], up.src)
  const right = run(root, ['--from', `local=${up.src}`])
  assert.equal(right.status, 0, right.stderr)
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/skills/foo/SKILL.md'), 'utf8'), 'v1\n')
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/skills/committed-browser-proof/SKILL.md'), 'utf8'), 'proof-sentinel\n')
  assert.equal(readFileSync(path.join(root, 'plugins/pstack-extras/.codex-plugin/plugin.json'), 'utf8'), 'codex-manifest-sentinel\n')
})

function exists(root, rel) {
  try {
    statSync(path.join(root, rel))
    return true
  } catch {
    return false
  }
}
