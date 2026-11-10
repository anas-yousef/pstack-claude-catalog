import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readPin, writePin } from '../scripts/lib/pin.mjs'
import { writeConfig } from '../scripts/lib/toml.mjs'
import { sessionSettings } from '../scripts/lib/sheet.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INIT = path.join(ROOT, 'tools', 'init.mjs')
const MAIN = 'bfd48a1b300dbad50f6ea2e30f4a3edbe9737943'
const CHECK_RULES = ['Bash(node scripts/pstack-claude-check.mjs:*)', 'Bash(node scripts/check-pstack.mjs:*)']
const CODEX_TASK_NAMES = 'For Codex `spawn_agent`, task names must use only lowercase letters, digits, and underscores; replace spaces and hyphens in role names with underscores (for example, `how explorer` becomes `how_explorer`).'
const ROUTING = 'poteto-mode is the only entry point. Inside it, a from-scratch rebuild of an old repo (the current one or one named by path or URL) starts with pstack-extras `greenfield`; any other new product or feature, including one in an existing repo, starts with `pstack-extras:prd` (not any other PRD skill), then spec-driven-development, then build-auto. Changes to existing behavior, refactors, and bug fixes use poteto-mode\'s own playbooks. After poteto-mode builds or ships a browser UI change, it runs `pstack-extras:ux-critique`.'
const MARKER = `<!-- pstack:begin -->\n${ROUTING}\nFor pstack skills, Codex must read .codex/pstack-models.md; Claude must read .claude/pstack-models.md. Use your runtime's sheet for role overrides.\n${CODEX_TASK_NAMES}\nRun node scripts/pstack-claude-check.mjs as a single command (no chaining); it prints its own status.\n<!-- pstack:end -->\n`
const CLAUDE_MARKER = `<!-- pstack:begin -->\n${ROUTING}\n@.claude/pstack-models.md\nModel sheet: .claude/pstack-models.md.\nRun node scripts/pstack-claude-check.mjs as a single command (no chaining); it prints its own status.\n<!-- pstack:end -->\n`
const COMBINED_MARKER = MARKER.replace('Run node', '@.claude/pstack-models.md\nModel sheet: .claude/pstack-models.md.\nRun node')

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

function fresh(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'pstack-home-'))
  const repo = mkdtempSync(path.join(tmpdir(), 'pstack-repo-'))
  t.after(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })
  mkdirSync(path.join(home, 'bin'))
  for (const cli of ['codex', 'claude']) writeFileSync(path.join(home, 'bin', cli), `#!${process.execPath}
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
const args = process.argv.slice(2)
fs.appendFileSync(process.env.HOME + '/${cli}-calls.jsonl', JSON.stringify(args) + '\\n')
if ('${cli}' === 'claude' && args.slice(0, 3).join(' ') === 'plugin marketplace add') {
  const file = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude'), 'settings.json')
  const read = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const name = 'pstack-claude-catalog'
  const [input, ref] = args[3].split('#')
  const source = input.startsWith('https:')
    ? { source: input.endsWith('.json') ? 'url' : 'git', url: input }
    : input.startsWith('/') ? { source: input.endsWith('.json') ? 'file' : 'directory', path: input }
    : { source: 'github', repo: input }
  if (ref) source.ref = ref
  if (args.at(-1) === 'project') {
    const entry = read(file).extraKnownMarketplaces?.[name]
    if (process.env.PSTACK_TEST_CLAUDE_MANAGED_CONFLICT || (entry && !isDeepStrictEqual(entry.source, source))) {
      process.stderr.write("Cannot add marketplace " + name + ": its source doesn't match its extraKnownMarketplaces entry in user or managed settings; add it from the source that entry lists, or change the entry.")
      process.exit(1)
    }
    const projectFile = path.join(process.cwd(), '.claude/settings.json')
    const project = read(projectFile)
    project.extraKnownMarketplaces[name] = { source }
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\\n')
  } else {
    const user = read(file)
    user.extraKnownMarketplaces = { ...user.extraKnownMarketplaces, [name]: { source } }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(user, null, 2) + '\\n')
  }
}
if (args.join(' ').includes(process.env.PSTACK_TEST_${cli.toUpperCase()}_FAIL || 'never-fail')) {
  process.stderr.write('fixture install failure')
  process.exit(1)
}
`, { mode: 0o755 })
  git(['init', '-q', '-b', 'main'], repo)
  return { home, repo }
}

function childEnv(home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH}`, ...extraEnv }
  delete env.XDG_CACHE_HOME
  if (!Object.hasOwn(extraEnv, 'CODEX_HOME')) delete env.CODEX_HOME
  if (!Object.hasOwn(extraEnv, 'CLAUDE_CONFIG_DIR')) delete env.CLAUDE_CONFIG_DIR
  if (!Object.hasOwn(extraEnv, 'PSTACK_CATALOG')) delete env.PSTACK_CATALOG
  if (!Object.hasOwn(extraEnv, 'PSTACK_PROFILE')) delete env.PSTACK_PROFILE
  if (!Object.hasOwn(extraEnv, 'PSTACK_API')) delete env.PSTACK_API
  return env
}

function initArgs(args) {
  return args.includes('--commit') ? args : ['--commit', MAIN, ...args]
}

function run(repo, home, script, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...initArgs(args)], {
    cwd: repo,
    encoding: 'utf8',
    env: childEnv(home, { PSTACK_CATALOG: ROOT, ...extraEnv }),
  })
}

function pipeInit(repo, home, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, ['-', ...initArgs(args)], {
    cwd: repo,
    encoding: 'utf8',
    env: childEnv(home, { PSTACK_CATALOG: ROOT, ...extraEnv }),
    input: readFileSync(INIT),
  })
}

function pipeInitAsync(repo, home, args = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-', ...initArgs(args)], {
      cwd: repo,
      env: childEnv(home, { PSTACK_CATALOG: ROOT, ...extraEnv }),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.end(readFileSync(INIT))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function settings(repo) {
  return JSON.parse(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'))
}

function walkFiles(dir, into) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.cache') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, into)
    else into.set(full, readFileSync(full))
  }
}

function snapshot(repo, home) {
  const into = new Map()
  walkFiles(repo, into)
  walkFiles(path.join(home, '.codex'), into)
  walkFiles(path.join(home, '.claude'), into)
  walkFiles(path.join(repo, '.claude'), into)
  return into
}

function assertSameBytes(left, right) {
  assert.deepEqual([...right.keys()].sort(), [...left.keys()].sort())
  for (const file of left.keys()) assert.equal(right.get(file).equals(left.get(file)), true, file)
}

function replaceLine(file, prefix, next) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n').map((line) => (line.startsWith(prefix) ? next : line))
  writeFileSync(file, lines.join('\n'))
}

function modelLines(repo) {
  const text = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  const end = text.search(/^\[/m)
  const head = end === -1 ? text : text.slice(0, end)
  return head.split('\n').filter((line) => line.startsWith('model'))
}

test('a new repo installs both sheets and records the session model', (t) => {
  const { home, repo } = fresh(t)
  mkdirSync(path.join(home, '.codex'), { recursive: true })
  const homeBefore = '# kept\nmodel = "old-model"\nmodel_reasoning_effort = "low"\nsandbox_mode = "workspace-write"\n\n[ features ] # team\nmulti_agent = true\n\n[mcp_servers.local]\ncommand = "node"\n'
  writeFileSync(path.join(home, '.codex', 'config.toml'), homeBefore)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.repo, 'https://github.com/anas-yousef/pstack-claude-catalog')
  assert.match(pin.commit, /^[0-9a-f]{40}$/)
  assert.equal(pin.profile, 'balanced')
  assert.equal(pin.codexProfile, 'codex-balanced')
  assert.deepEqual(pin.plugins, ['pstack', 'pstack-extras'])
  assert.equal(existsSync(path.join(repo, 'plugins')), false)

  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.equal((agentsMd.match(/^## pstack$/gm) || []).length, 0)
  assert.equal(agentsMd, COMBINED_MARKER)
  assert.equal((agentsMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
  assert.match(readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8'), /^Profile: balanced\./m)
  assert.deepEqual(readdirSync(path.join(repo, 'scripts', 'lib')).sort(), ['pin.mjs', 'remote.mjs'])
  assert.equal(existsSync(path.join(repo, 'scripts', 'pstack-claude-check.mjs')), true)
  assert.equal(existsSync(path.join(repo, 'scripts', 'setup-pstack-claude.mjs')), false)
  assert.equal(existsSync(path.join(home, '.codex', 'pstack-models.md')), false)
  assert.equal(existsSync(path.join(home, '.codex', 'AGENTS.md')), false)
  const trusted = JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8'))
  assert.equal(trusted.projects[path.resolve(repo)].hasTrustDialogAccepted, true)
  assert.deepEqual(Object.keys(trusted), ['projects'])
  assert.equal(existsSync(path.join(repo, '.cache')), false)

  const lines = modelLines(repo)
  console.log(`fresh-HOME config.toml\n${lines.join('\n')}`)
  assert.deepEqual(lines, ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])
  assert.deepEqual(settings(repo), {
    model: 'sonnet',
    effortLevel: 'high',
    permissions: { allow: CHECK_RULES },
    extraKnownMarketplaces: {
      'pstack-claude-catalog': {
        source: { source: 'github', repo: 'anas-yousef/pstack-claude-catalog' },
      },
    },
    enabledPlugins: {
      'pstack@pstack-claude-catalog': true,
      'pstack-extras@pstack-claude-catalog': true,
    },
  })
  const homeConfig = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
  assert.ok(homeConfig.includes(homeBefore.trimEnd()))
  assert.match(homeConfig, /trust_level = "trusted"/)
  const repoSettings = readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')
  assert.match(homeConfig, /^# kept$/m)
  assert.match(homeConfig, /^sandbox_mode = "workspace-write"$/m)
  assert.match(homeConfig, /\[ features \] # team\nmulti_agent = true/)
  assert.equal((homeConfig.match(/\[ features \]/g) || []).length, 1)
  assert.match(homeConfig, /\[mcp_servers\.local\]\ncommand = "node"/)
  assert.doesNotMatch(agentsMd, /gpt-6/)

  assert.deepEqual(readdirSync(path.join(repo, '.codex')).sort(), ['config.toml', 'pstack-models.md'])
  const projectConfig = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(projectConfig, /\[plugins\."pstack@pstack-claude-catalog"\]\nenabled = true/)
  assert.match(projectConfig, /\[plugins\."pstack-extras@pstack-claude-catalog"\]\nenabled = true/)
  assert.match(projectConfig, new RegExp(`ref = "${pin.commit}"`))

  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  assert.equal(readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), homeConfig)
  assert.equal(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'), repoSettings)
  assert.match(agentsMd, /node scripts\/pstack-claude-check\.mjs/)
  const before = snapshot(repo, home)
  const second = pipeInit(repo, home)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout, '')
  assertSameBytes(before, snapshot(repo, home))
})

test('an AGENTS.md-only repo gets one pstack section and no CLAUDE.md', (t) => {
  const { home, repo } = fresh(t)
  const agentsBefore = '# Agents\n\nKeep this.\n'
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.equal(agentsMd, `${agentsBefore}\n${COMBINED_MARKER}`)
  assert.equal((agentsMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
})

test('an AGENTS.md include outside the managed block stays untouched', (t) => {
  const { home, repo } = fresh(t)
  const agentsBefore = '# Agents\n\n@.claude/pstack-models.md\n\nKeep this.\n'
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.equal((agentsMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.equal(agentsMd, `${agentsBefore}\n${COMBINED_MARKER.replace('@.claude/pstack-models.md\n', '')}`)
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
})

test('CLAUDE.md symlinked to AGENTS.md keeps the combined block and include', (t) => {
  for (const absolute of [false, true]) {
    const { home, repo } = fresh(t)
    const agentsFile = path.join(repo, 'AGENTS.md')
    const claudeFile = path.join(repo, 'CLAUDE.md')
    const before = `# Agents\n\nKeep this.\n\n${COMBINED_MARKER}`
    writeFileSync(agentsFile, before)
    const target = absolute ? agentsFile : 'AGENTS.md'
    symlinkSync(target, claudeFile)
    for (let i = 0; i < 2; i++) {
      const init = pipeInit(repo, home)
      assert.equal(init.status, 0, init.stderr)
      assert.equal(readlinkSync(claudeFile), target)
      assert.equal(readFileSync(agentsFile, 'utf8'), before)
    }
  }
})

test('an old AGENTS.md pstack block gains the naming rule and exactly one Claude include', (t) => {
  for (const block of [MARKER.replace(`${CODEX_TASK_NAMES}\n`, ''), COMBINED_MARKER, '## pstack\n\n@.claude/pstack-models.md\nOld instructions.\n']) {
    const { home, repo } = fresh(t)
    writeFileSync(path.join(repo, 'AGENTS.md'), `# Agents\n\n${block}\n## Product\nKeep this.\n`)
    const init = pipeInit(repo, home)
    assert.equal(init.status, 0, init.stderr)
    assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
    const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
    assert.equal((agentsMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
    assert.equal((agentsMd.match(/<!-- pstack:begin -->/g) || []).length, 1)
    assert.ok(agentsMd.includes(COMBINED_MARKER))
    assert.match(agentsMd, /^## Product\nKeep this\.$/m)
    const again = pipeInit(repo, home)
    assert.equal(again.status, 0, again.stderr)
    assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  }
})

test('an existing repo keeps its docs and product skills', (t) => {
  const { home, repo } = fresh(t)
  const claudeBefore = '# Product\n\nKeep this.'
  const agentsBefore = '# Agents\n\nKeep this too.\n'
  writeFileSync(path.join(repo, 'CLAUDE.md'), claudeBefore)
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const skill = path.join(repo, '.claude', 'skills', 'ship', 'SKILL.md')
  const other = path.join(repo, 'skills', 'mine', 'SKILL.md')
  mkdirSync(path.dirname(skill), { recursive: true })
  mkdirSync(path.dirname(other), { recursive: true })
  writeFileSync(skill, 'product skill\n')
  writeFileSync(other, 'other skill\n')
  mkdirSync(path.join(repo, '.codex'), { recursive: true })
  writeFileSync(path.join(repo, '.codex', 'config.toml'), '[features]\nmulti_agent = true\n')
  writeFileSync(path.join(repo, '.claude', 'settings.json'), `${JSON.stringify({
    theme: 'dark',
    permissions: { allow: ['Bash', 'Bash(node scripts/pstack-claude-check.mjs)', 'Bash(node scripts/pstack-claude-check.mjs *)'], deny: ['Bash(rm *)'] },
    model: 'old',
    extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'acme/tools', ref: 'v1' } } },
  }, null, 2)}\n`)
  const claudeHome = path.join(home, '.claude.json')
  writeFileSync(claudeHome, `${JSON.stringify({
    numStartups: 4,
    projects: { '/other': { hasTrustDialogAccepted: false, extra: 1 } },
  }, null, 2)}\n`)

  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')

  const claudeMd = readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8')
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.ok(claudeMd.endsWith(`\n\n${CLAUDE_MARKER}`))
  assert.ok(agentsMd.endsWith(`\n\n${MARKER}`))
  assert.doesNotMatch(claudeMd, /AGENTS\.md/)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
  assert.equal((claudeMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.doesNotMatch(agentsMd, /^@\.claude\/pstack-models\.md$/m)
  assert.doesNotMatch(claudeMd, /This repo pins/)
  assert.doesNotMatch(agentsMd, /This repo pins/)
  assert.equal(readFileSync(skill, 'utf8'), 'product skill\n')
  assert.equal(readFileSync(other, 'utf8'), 'other skill\n')
  const projectConfig = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(projectConfig, /\[features\]\nmulti_agent = true/)
  assert.match(projectConfig, /enabled = true/)
  const lines = modelLines(repo)
  console.log(`existing-repo project config.toml\n${lines.join('\n')}`)
  assert.deepEqual(lines, ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])
  const parsed = settings(repo)
  assert.equal(parsed.model, 'sonnet')
  assert.equal(parsed.effortLevel, 'high')
  assert.equal(parsed.permissions.defaultMode, undefined)
  assert.equal(parsed.theme, 'dark')
  assert.deepEqual(parsed.permissions.deny, ['Bash(rm *)'])
  assert.deepEqual(parsed.permissions.allow, ['Bash', 'Bash(node scripts/pstack-claude-check.mjs)', 'Bash(node scripts/pstack-claude-check.mjs *)', ...CHECK_RULES])
  const trusted = JSON.parse(readFileSync(claudeHome, 'utf8'))
  assert.equal(trusted.numStartups, 4)
  assert.deepEqual(trusted.projects['/other'], { hasTrustDialogAccepted: false, extra: 1 })
  assert.equal(trusted.projects[path.resolve(repo)].hasTrustDialogAccepted, true)
  assert.match(readFileSync(claudeHome, 'utf8'), /^ {2}"numStartups": 4,$/m)
  assert.equal(parsed.extraKnownMarketplaces.other.source.ref, 'v1')
  assert.equal(parsed.extraKnownMarketplaces['pstack-claude-catalog'].source.repo, 'anas-yousef/pstack-claude-catalog')
  assert.equal(parsed.extraKnownMarketplaces['pstack-claude-catalog'].source.ref, undefined)
  assert.equal(parsed.enabledPlugins['pstack@pstack-claude-catalog'], true)
  const repoSettings = readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')
  const trustedRaw = readFileSync(claudeHome, 'utf8')

  assert.equal(run(repo, home, INIT).status, 0)
  assert.equal(readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), claudeMd)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  assert.equal(readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8'), projectConfig)
  assert.equal(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'), repoSettings)
  assert.equal(readFileSync(claudeHome, 'utf8'), trustedRaw)
  assert.equal(readFileSync(skill, 'utf8'), 'product skill\n')
  assert.equal((claudeMd.match(/^## pstack$/gm) || []).length, 0)
  assert.match(claudeMd, /^## Product$|^# Product$/m)
})

test('--ask-permissions leaves permission keys absent or unchanged across profiles and reruns', (t) => {
  for (const existing of [false, true]) {
    const { home, repo } = fresh(t)
    if (existing) {
      mkdirSync(path.join(repo, '.claude'))
      mkdirSync(path.join(repo, '.codex'))
      writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({
        permissions: { defaultMode: 'plan', allow: ['Read'], deny: ['Bash(rm:*)'] },
      }))
      writeFileSync(path.join(repo, '.codex', 'config.toml'), 'approval_policy = "on-request" # keep\nsandbox_mode = "read-only"\n\n[features]\nmulti_agent = true\n')
    }
    const args = ['--ask-permissions', '--profile', 'lean', '--codex-profile', 'codex-design-heavy']
    const init = pipeInit(repo, home, args)
    assert.equal(init.status, 0, init.stderr)
    const config = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
    if (existing) {
      assert.deepEqual(settings(repo).permissions, { defaultMode: 'plan', allow: ['Read', ...CHECK_RULES], deny: ['Bash(rm:*)'] })
      assert.match(config, /^approval_policy = "on-request" # keep$/m)
      assert.match(config, /^sandbox_mode = "read-only"$/m)
    } else {
      assert.deepEqual(settings(repo).permissions, { allow: CHECK_RULES })
      assert.doesNotMatch(config, /approval_policy|sandbox_mode/)
    }
    assert.deepEqual(modelLines(repo), ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])
    const saved = snapshot(repo, home)
    const again = pipeInit(repo, home, args)
    assert.equal(again.status, 0, again.stderr)
    assertSameBytes(saved, snapshot(repo, home))

    const defaults = pipeInit(repo, home, ['--profile', 'design-heavy-extra'])
    assert.equal(defaults.status, 0, defaults.stderr)
    assert.equal(settings(repo).permissions.defaultMode, existing ? 'plan' : undefined)
    assert.equal(JSON.parse(readFileSync(path.join(home, '.claude/settings.json'))).permissions.defaultMode, 'bypassPermissions')
    const next = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
    assert.match(next, /^approval_policy = "never"(?: # keep)?$/m)
    assert.match(next, /^sandbox_mode = "danger-full-access"$/m)
    const optOut = pipeInit(repo, home, ['--ask-permissions'])
    assert.equal(optOut.status, 0, optOut.stderr)
    assert.equal(settings(repo).permissions.defaultMode, existing ? 'plan' : undefined)
    assert.equal(JSON.parse(readFileSync(path.join(home, '.claude/settings.json'))).permissions.defaultMode, undefined)
    assert.deepEqual(settings(repo).permissions.allow, existing ? ['Read', ...CHECK_RULES] : CHECK_RULES)
    assert.deepEqual(settings(repo).permissions.deny, existing ? ['Bash(rm:*)'] : undefined)
    const opted = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
    assert.doesNotMatch(opted, /^approval_policy|^sandbox_mode/m)
    if (existing) assert.match(opted, /\[features\]\nmulti_agent = true/)
    const savedOptOut = snapshot(repo, home)
    assert.equal(pipeInit(repo, home, ['--ask-permissions']).status, 0)
    assertSameBytes(savedOptOut, snapshot(repo, home))
  }
})

test('flags select the pin and a bad profile writes nothing', (t) => {
  const { home, repo } = fresh(t)
  const selected = run(repo, home, INIT, ['--profile', 'lean', '--codex-profile', 'codex-lean', '--commit', MAIN])
  assert.equal(selected.status, 0, selected.stderr)
  assert.equal(selected.stdout, '')
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.profile, 'lean')
  assert.equal(pin.codexProfile, 'codex-lean')
  assert.equal(pin.commit, MAIN)
  const again = run(repo, home, INIT, ['--profile', 'lean', '--codex-profile', 'codex-lean', '--commit', MAIN])
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'), `${JSON.stringify(pin, null, 2)}\n`)

  const { home: otherHome, repo: other } = fresh(t)
  const bad = run(other, otherHome, INIT, ['--profile', '../balanced'])
  assert.notEqual(bad.status, 0)
  assert.equal(existsSync(path.join(other, '.claude', 'pstack-claude-pin.json')), false)
  assert.match(bad.stderr, /plain slugs/)
})

test('selected role sheets stay separate and offer a per-chat profile override', (t) => {
  const { home, repo } = fresh(t)
  writeFileSync(path.join(repo, 'CLAUDE.md'), '# Product\n')
  const init = pipeInit(repo, home, ['--profile', 'lean', '--codex-profile', 'codex-design-heavy-extra'])
  assert.equal(init.status, 0, init.stderr)
  const pin = readPin(repo)
  const codex = readFileSync(path.join(repo, '.codex', 'pstack-models.md'), 'utf8')
  const claude = readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8')
  for (const [sheet, profile, profiles] of [
    [codex, pin.codexProfile, ['codex-balanced', 'codex-design-heavy', 'codex-design-heavy-extra', 'codex-lean']],
    [claude, pin.profile, ['balanced', 'design-heavy', 'design-heavy-extra', 'design-heavy-fable', 'lean', 'max']],
  ]) {
    const source = readFileSync(path.join(ROOT, 'profiles', `${profile}.md`), 'utf8')
    assert.ok(sheet.includes(source), profile)
    const guide = sheet.split('\n').find((line) => line.startsWith('Profiles:'))
    assert.ok(guide, profile)
    assert.ok(guide.startsWith(`Profiles: ${profiles.join(', ')}.`))
    assert.ok(guide.includes('Use <profile> for this chat'))
    assert.ok(guide.includes(`https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/${pin.commit}/profiles/<profile>.md`))
    assert.match(guide, /override.*role rows/)
    assert.match(guide, /fetch.*over the network/)
  }
  assert.match(codex, /^judgment and prose: gpt-6-astra @xhigh$/m)
  assert.match(claude, /^judgment and prose: sonnet @high$/m)
  const agents = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.match(agents, /Codex.*\.codex\/pstack-models\.md/)
  assert.match(agents, /Claude.*\.claude\/pstack-models\.md/)
  assert.doesNotMatch(agents, /^@\.claude\/pstack-models\.md$/m)
  assert.match(readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), /^@\.claude\/pstack-models\.md$/m)

  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(path.join(repo, '.codex', 'pstack-models.md'), 'utf8'), codex)
  assert.equal(readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8'), claude)
  const switched = pipeInit(repo, home, ['--codex-profile', 'codex-lean', '--profile', 'lean'])
  assert.equal(switched.status, 0, switched.stderr)
  const next = readFileSync(path.join(repo, '.codex', 'pstack-models.md'), 'utf8')
  assert.match(next, /^Profile: codex-lean\./m)
  assert.match(next, /^judgment and prose: gpt-6\.1-sol @high$/m)
  assert.doesNotMatch(next, /^Profile: codex-design-heavy-extra\./m)
  assert.equal(readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8'), claude)
})

test('the profile index matches the catalog directory', () => {
  const profiles = path.join(ROOT, 'profiles')
  const names = readdirSync(profiles, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3)).sort()
  assert.deepEqual(JSON.parse(readFileSync(path.join(profiles, 'index.json'), 'utf8')), names)
})

test('profile lists follow the catalog index', (t) => {
  const { home, repo } = fresh(t)
  const catalog = mkdtempSync(path.join(tmpdir(), 'pstack-cat-'))
  t.after(() => rmSync(catalog, { recursive: true, force: true }))
  for (const rel of ['profiles', 'scripts', '.claude-plugin']) {
    cpSync(path.join(ROOT, rel), path.join(catalog, rel), { recursive: true })
  }
  writeFileSync(path.join(catalog, 'profiles', 'future.md'), 'new Claude profile\n')
  writeFileSync(path.join(catalog, 'profiles', 'codex-future.md'), 'new Codex profile\n')
  writeFileSync(path.join(catalog, 'profiles', 'notes.txt'), 'not a profile\n')
  mkdirSync(path.join(catalog, 'profiles', 'directory.md'))
  rmSync(path.join(catalog, 'profiles', 'max.md'))
  const index = path.join(catalog, 'profiles', 'index.json')
  const names = JSON.parse(readFileSync(index, 'utf8')).filter((name) => name !== 'max')
  writeFileSync(index, JSON.stringify([...names, 'future', 'codex-future'].sort()))
  const init = pipeInit(repo, home, ['--commit', MAIN], { PSTACK_CATALOG: catalog })
  assert.equal(init.status, 0, init.stderr)
  for (const [runtime, expected] of [
    ['claude', 'balanced, design-heavy, design-heavy-extra, design-heavy-fable, future, lean'],
    ['codex', 'codex-balanced, codex-design-heavy, codex-design-heavy-extra, codex-future, codex-lean'],
  ]) {
    const sheet = readFileSync(path.join(repo, `.${runtime}`, 'pstack-models.md'), 'utf8')
    assert.ok(sheet.includes(`Profiles: ${expected}.`))
  }
})

test('every Codex sheet carries the spawn_agent naming rule and its roles yield valid task names', () => {
  const profiles = path.join(ROOT, 'profiles')
  const sheets = readdirSync(profiles).filter((name) => /^codex-.*\.md$/.test(name))
  assert.ok(sheets.length > 0)
  for (const name of sheets) {
    const text = readFileSync(path.join(profiles, name), 'utf8')
    assert.ok(text.includes(CODEX_TASK_NAMES), `${name}: missing task naming rule`)
    const rows = [...text.matchAll(/^([a-z][^:\n]*):\s+(\S.*)$/gm)]
      .filter(([, role]) => role !== 'default effort' && role !== 'panel vendors')
    assert.ok(rows.length > 0, `${name}: missing roles`)
    for (const [, roles] of rows) {
      for (const role of roles.split(',')) {
        const taskName = role.trim().toLowerCase().replace(/[\s-]+/g, '_')
        assert.match(taskName, /^[a-z0-9_]+$/, `${name}: ${role}`)
      }
    }
  }
})

test('every sheet names its own main session', () => {
  const expect = {
    'balanced.md': 'main session: sonnet @high',
    'design-heavy.md': 'main session: sonnet @high',
    'design-heavy-extra.md': 'main session: opus @high',
    'lean.md': 'main session: sonnet @high',
    'max.md': 'main session: sonnet @high',
    'codex-balanced.md': 'main session: gpt-6.1-sol @high',
    'codex-design-heavy.md': 'main session: gpt-6.1-sol @high',
    'codex-design-heavy-extra.md': 'main session: gpt-6-astra @high',
    'codex-lean.md': 'main session: gpt-6.1-sol @high',
  }
  const check = path.join(ROOT, 'plugins/pstack/skills/setup-pstack/scripts/check-sheet.sh')
  for (const [name, line] of Object.entries(expect)) {
    const file = path.join(ROOT, 'profiles', name)
    const text = readFileSync(file, 'utf8')
    assert.equal((text.match(/^main session:/gm) || []).length, 1, name)
    assert.match(text, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), name)
    const result = spawnSync('sh', [check, file], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout || result.stderr)
    assert.equal(result.stdout, 'sheet ok\n')
  }
})

test('design-heavy-extra writes opus and astra for the main session', (t) => {
  const { home, repo } = fresh(t)
  const selected = pipeInit(repo, home, ['--profile', 'design-heavy-extra', '--codex-profile', 'codex-design-heavy-extra'], { PSTACK_PROFILE: 'lean' })
  assert.equal(selected.status, 0, selected.stderr)
  assert.equal(selected.stdout, '')
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.profile, 'design-heavy-extra')
  assert.equal(pin.codexProfile, 'codex-design-heavy-extra')
  assert.equal(settings(repo).model, 'opus')
  assert.equal(settings(repo).effortLevel, 'high')
  assert.deepEqual(modelLines(repo), ['model = "gpt-6-astra"', 'model_reasoning_effort = "high"'])
})

test('PSTACK_PROFILE switches the Claude main session', (t) => {
  const { home, repo } = fresh(t)
  const selected = pipeInit(repo, home, [], { PSTACK_PROFILE: 'design-heavy-extra' })
  assert.equal(selected.status, 0, selected.stderr)
  assert.equal(selected.stdout, '')
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.profile, 'design-heavy-extra')
  assert.equal(pin.codexProfile, 'codex-design-heavy-extra')
  assert.equal(settings(repo).model, 'opus')
  assert.equal(settings(repo).effortLevel, 'high')
  assert.deepEqual(modelLines(repo), ['model = "gpt-6-astra"', 'model_reasoning_effort = "high"'])
})

test('a role row edit does not change the main session', (t) => {
  const { home, repo } = fresh(t)
  const catalog = mkdtempSync(path.join(tmpdir(), 'pstack-cat-'))
  t.after(() => rmSync(catalog, { recursive: true, force: true }))
  cpSync(path.join(ROOT, 'profiles'), path.join(catalog, 'profiles'), { recursive: true })
  cpSync(path.join(ROOT, 'scripts'), path.join(catalog, 'scripts'), { recursive: true })
  mkdirSync(path.join(catalog, '.claude-plugin'), { recursive: true })
  cpSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), path.join(catalog, '.claude-plugin', 'marketplace.json'))
  replaceLine(path.join(catalog, 'profiles', 'balanced.md'), 'feature, refactoring:', 'feature, refactoring: haiku @low')
  replaceLine(path.join(catalog, 'profiles', 'codex-balanced.md'), 'feature, refactoring:', 'feature, refactoring: gpt-6-luna @low')
  const init = pipeInit(repo, home, [], { PSTACK_CATALOG: catalog })
  assert.equal(init.status, 0, init.stderr)
  assert.match(readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8'), /^feature, refactoring: haiku @low$/m)
  assert.match(readFileSync(path.join(repo, '.codex', 'pstack-models.md'), 'utf8'), /^feature, refactoring: gpt-6-luna @low$/m)
  assert.equal(existsSync(path.join(home, '.codex', 'pstack-models.md')), false)
  assert.equal(existsSync(path.join(home, '.codex', 'AGENTS.md')), false)
  assert.equal(settings(repo).model, 'sonnet')
  assert.equal(settings(repo).effortLevel, 'high')
  assert.deepEqual(modelLines(repo), ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])
})

test('a sheet without a main session row makes init exit non-zero', (t) => {
  const { home, repo } = fresh(t)
  const catalog = mkdtempSync(path.join(tmpdir(), 'pstack-cat-'))
  t.after(() => rmSync(catalog, { recursive: true, force: true }))
  cpSync(path.join(ROOT, 'profiles'), path.join(catalog, 'profiles'), { recursive: true })
  cpSync(path.join(ROOT, 'scripts'), path.join(catalog, 'scripts'), { recursive: true })
  mkdirSync(path.join(catalog, '.claude-plugin'), { recursive: true })
  cpSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), path.join(catalog, '.claude-plugin', 'marketplace.json'))
  const sheet = path.join(catalog, 'profiles', 'balanced.md')
  writeFileSync(sheet, readFileSync(sheet, 'utf8').split('\n').filter((line) => !line.startsWith('main session:')).join('\n'))
  const init = pipeInit(repo, home, [], { PSTACK_CATALOG: catalog })
  assert.notEqual(init.status, 0)
  assert.match(init.stderr, /main session/)
})

test('user toml survives root edits byte for byte', (t) => {
  const { home, repo } = fresh(t)
  const tail = [
    '"quoted key" = "keep"',
    '',
    'story = """',
    '[marketplaces.pstack-claude-catalog]',
    'model = "hijack"',
    '"""',
    '',
    '[mcp_servers.x]',
    'args = [',
    '  "--flag",',
    '  "value",',
    ']',
    '',
  ].join('\n')
  mkdirSync(path.join(repo, '.codex'), { recursive: true })
  writeFileSync(path.join(repo, '.codex', 'config.toml'), `model = "old" # mine\n\n${tail}`)
  const homeFile = path.join(home, '.codex', 'config.toml')
  mkdirSync(path.dirname(homeFile), { recursive: true })
  writeFileSync(homeFile, tail)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  const project = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  const mcp = tail.slice(tail.indexOf('[mcp_servers.x]'))
  assert.ok(project.includes('"quoted key" = "keep"\n'))
  assert.ok(project.includes('story = """\n[marketplaces.pstack-claude-catalog]\nmodel = "hijack"\n"""\n'))
  assert.equal((project.match(/model = "hijack"/g) || []).length, 1)
  assert.ok(project.includes(mcp))
  assert.match(project, /^model = "gpt-6\.1-sol" # mine$/m)
  const homeText = readFileSync(homeFile, 'utf8')
  assert.ok(homeText.startsWith(tail.trimEnd()))
  assert.match(homeText, /trust_level = "trusted"/)
  assert.equal(existsSync(`${homeFile}.bak`), false)
  const projectFile = path.join(repo, '.codex', 'config.toml')
  assert.equal(existsSync(`${projectFile}.bak`), false)
  const saved = readFileSync(projectFile, 'utf8')
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(projectFile, 'utf8'), saved)
  assert.equal(readFileSync(homeFile, 'utf8'), homeText)
})

test('profile flags pair the codex sheet unless one is named', (t) => {
  const { home, repo } = fresh(t)
  const paired = pipeInit(repo, home, ['--profile', 'lean'], { PSTACK_PROFILE: 'max' })
  assert.equal(paired.status, 0, paired.stderr)
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.profile, 'lean')
  assert.equal(pin.codexProfile, 'codex-lean')
  const { home: maxHome, repo: maxRepo } = fresh(t)
  const maxed = pipeInit(maxRepo, maxHome, [], { PSTACK_PROFILE: 'max' })
  assert.equal(maxed.status, 0, maxed.stderr)
  const maxPin = JSON.parse(readFileSync(path.join(maxRepo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(maxPin.profile, 'max')
  assert.equal(maxPin.codexProfile, 'codex-balanced')
  const { home: overHome, repo: overRepo } = fresh(t)
  const over = pipeInit(overRepo, overHome, ['--codex-profile', 'codex-lean'], { PSTACK_PROFILE: 'design-heavy-extra' })
  assert.equal(over.status, 0, over.stderr)
  const overPin = JSON.parse(readFileSync(path.join(overRepo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(overPin.profile, 'design-heavy-extra')
  assert.equal(overPin.codexProfile, 'codex-lean')
  assert.deepEqual(modelLines(overRepo), ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])
})

test('the installed checker reports pin vs main without writing', (t) => {
  const { home, repo } = fresh(t)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  for (const rel of ['scripts/pstack-claude-check.mjs', 'scripts/lib/pin.mjs', 'scripts/lib/remote.mjs']) {
    assert.equal(readFileSync(path.join(repo, rel), 'utf8'), readFileSync(path.join(ROOT, rel), 'utf8'))
  }
  const preload = path.join(home, 'fetch.mjs')
  const check = (script = 'scripts/pstack-claude-check.mjs') => spawnSync(process.execPath, ['--import', preload, script], {
    cwd: repo, encoding: 'utf8', env: childEnv(home),
  })
  for (const [body, status, stdout, stderr] of [
    [`globalThis.fetch = async () => new Response('${MAIN} refs/heads/main')`, 0, 'pstack: current (exit 0)\n', ''],
    [`globalThis.fetch = async () => new Response('${'a'.repeat(40)} refs/heads/main')`, 1, 'pstack: outdated (exit 1)\n', ''],
    ["globalThis.fetch = async () => { throw new TypeError('fetch failed') }", 0, 'pstack: offline (exit 0)\n', ''],
    ["globalThis.fetch = async () => new Response('', {status: 404})", 1, '', /cannot read main/],
  ]) {
    writeFileSync(preload, body)
    const before = snapshot(repo, home)
    for (const script of ['scripts/pstack-claude-check.mjs', 'scripts/check-pstack.mjs']) {
      const result = check(script)
      assert.equal(result.status, status, result.stderr)
      assert.equal(result.stdout, stdout)
      if (stderr instanceof RegExp) assert.match(result.stderr, stderr)
      else assert.equal(result.stderr, stderr)
    }
    assertSameBytes(before, snapshot(repo, home))
  }
  writeFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), '{')
  const broken = check()
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /cannot read/)
})

test('a broken settings file is replaced and an old heading is migrated', (t) => {
  const { home, repo } = fresh(t)
  mkdirSync(path.join(repo, '.claude'), { recursive: true })
  const settingsFile = path.join(repo, '.claude', 'settings.json')
  writeFileSync(path.join(repo, 'AGENTS.md'), '# Notes\n\n## pstack\n\nold prose\n\n## Keep me\n\nyes\n')
  const catalog = mkdtempSync(path.join(tmpdir(), 'pstack-cat-'))
  t.after(() => rmSync(catalog, { recursive: true, force: true }))
  cpSync(path.join(ROOT, 'profiles'), path.join(catalog, 'profiles'), { recursive: true })
  cpSync(path.join(ROOT, 'scripts'), path.join(catalog, 'scripts'), { recursive: true })
  mkdirSync(path.join(catalog, '.claude-plugin'), { recursive: true })
  cpSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), path.join(catalog, '.claude-plugin', 'marketplace.json'))
  const sheet = path.join(catalog, 'profiles', 'balanced.md')
  writeFileSync(sheet, readFileSync(sheet, 'utf8').replace('main session: sonnet @high', 'main session: sonnet @max'))
  writeFileSync(settingsFile, `${JSON.stringify({ model: 'old', effortLevel: 'xhigh' }, null, 2)}\n`)
  const init = pipeInit(repo, home, [], { PSTACK_CATALOG: catalog })
  assert.equal(init.status, 0, init.stderr)
  const parsed = settings(repo)
  assert.equal(parsed.model, 'sonnet')
  assert.equal(Object.hasOwn(parsed, 'effortLevel'), false)
  const agents = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.match(agents, /<!-- pstack:begin -->/)
  assert.match(agents, /## Keep me\n\nyes\n/)
  assert.equal((agents.match(/^## pstack$/gm) || []).length, 0)
})

test('truncated settings are backed up', (t) => {
  const { home, repo } = fresh(t)
  mkdirSync(path.join(repo, '.claude'), { recursive: true })
  const settings = path.join(repo, '.claude', 'settings.json')
  writeFileSync(settings, '{')
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.ok(init.stdout.includes(`backed up ${settings} to ${settings}.bak`))
  assert.equal(readFileSync(`${settings}.bak`, 'utf8'), '{')
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).model, 'sonnet')
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.stdout, '')
  assert.equal(readFileSync(`${settings}.bak`, 'utf8'), '{')
})

test('migration stops at the next heading and markers replace only their span', (t) => {
  const { home, repo } = fresh(t)
  const agentsFile = path.join(repo, 'AGENTS.md')
  writeFileSync(agentsFile, '# Notes\n\n## pstack\n\nold prose\n\n# Deployment\n\nship it\n')
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  const migrated = readFileSync(agentsFile, 'utf8')
  assert.match(migrated, /# Notes\n\n# Deployment\n\nship it\n/)
  assert.equal((migrated.match(/^## pstack$/gm) || []).length, 0)
  assert.ok(migrated.endsWith(`\n${COMBINED_MARKER}`))
  assert.equal((migrated.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  writeFileSync(agentsFile, '# Notes\n\n## pstack\n\nstale section\n\n# Deployment\n\nship it\n\n<!-- pstack:begin -->\nstale\n<!-- pstack:end -->\n')
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  const kept = readFileSync(agentsFile, 'utf8')
  assert.match(kept, /^## pstack$/m)
  assert.match(kept, /stale section/)
  assert.match(kept, /# Deployment\n\nship it\n/)
  assert.ok(kept.includes(COMBINED_MARKER))
  assert.equal((kept.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.doesNotMatch(kept, /<!-- pstack:begin -->\nstale\n/)
})

test('toml edits keep commented headers and multiline strings', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pstack-toml-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'config.toml')
  const original = [
    'model = "old" # mine',
    '',
    'story = """',
    '[marketplaces.pstack-claude-catalog]',
    'model = "hijack"',
    '"""',
    '',
    '[ features ] # team',
    'multi_agent = true',
    '',
    '[features] # team',
    'also = true',
    '',
    '[ marketplaces.pstack-claude-catalog ] # pin',
    'source_type = "local"',
    '',
  ].join('\n')
  writeFileSync(file, original)
  const spec = {
    root: { model: 'gpt-6.1-sol', model_reasoning_effort: 'high' },
    tables: {
      'marketplaces.pstack-claude-catalog': {
        source_type: 'git',
        source: 'https://github.com/anas-yousef/pstack-claude-catalog.git',
        ref: 'abc',
      },
    },
  }
  writeConfig(file, spec)
  const next = readFileSync(file, 'utf8')
  assert.match(next, /^model = "gpt-6\.1-sol" # mine$/m)
  assert.match(next, /^model_reasoning_effort = "high"$/m)
  assert.ok(next.includes('story = """\n[marketplaces.pstack-claude-catalog]\nmodel = "hijack"\n"""\n'))
  assert.equal((next.match(/model = "hijack"/g) || []).length, 1)
  assert.ok(next.includes('[ features ] # team\nmulti_agent = true\n'))
  assert.ok(next.includes('[features] # team\nalso = true\n'))
  assert.equal((next.match(/source_type = "local"/g) || []).length, 0)
  assert.equal((next.match(/source_type = "git"/g) || []).length, 1)
  writeConfig(file, spec)
  assert.equal(readFileSync(file, 'utf8'), next)
})

test('invalid claude.json is left in place', (t) => {
  const { home, repo } = fresh(t)
  const file = path.join(home, '.claude.json')
  writeFileSync(file, '{')
  const init = pipeInit(repo, home)
  assert.notEqual(init.status, 0)
  assert.equal(readFileSync(file, 'utf8'), '{')
  assert.equal(existsSync(`${file}.bak`), false)
  assert.match(init.stderr, /is not JSON/)
  assert.equal(existsSync(path.join(repo, '.claude', 'pstack-claude-pin.json')), false)
  assert.equal(existsSync(path.join(repo, 'AGENTS.md')), false)
})

test('piped init loads every lib from the selected commit', { timeout: 60000 }, async (t) => {
  const { home, repo } = fresh(t)
  const sha = '0123456789abcdef0123456789abcdef01234567'
  const hits = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const { pathname } = url
    hits.push(pathname)
    if (pathname === '/repos/anas-yousef/pstack-claude-catalog/contents/profiles') {
      res.writeHead(403)
      res.end('API rate limit exceeded')
      return
    }
    const match = /^\/([^/]+)\/(.+)$/.exec(pathname)
    if (!match) {
      res.writeHead(500)
      res.end('wrong ref')
      return
    }
    const rel = decodeURIComponent(match[2])
    const file = path.join(ROOT, rel)
    try {
      if (!statSync(file).isFile()) throw new Error('dir')
    } catch {
      res.writeHead(404)
      res.end('missing')
      return
    }
    res.writeHead(200)
    res.end(readFileSync(file))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const cache = path.join(tmpdir(), 'pstack-init-libs')
  rmSync(cache, { recursive: true, force: true })
  const { port } = server.address()
  const init = await pipeInitAsync(repo, home, ['--commit', sha], {
    PSTACK_CATALOG: '',
    PSTACK_RAW: `http://127.0.0.1:${port}`,
    PSTACK_API: `http://127.0.0.1:${port}`,
  })
  assert.equal(init.status, 0, `${init.stderr}\n${hits.join('\n')}`)
  assert.ok(hits.length > 0)
  assert.ok(hits.every((hit) => hit.startsWith(`/${sha}/`)))
  assert.equal(hits.some((hit) => hit.split('/').includes('main')), false)
  assert.equal(existsSync(cache), false)
  const count = (rel) => hits.filter((hit) => hit === `/${sha}/${rel}`).length
  assert.equal(count('.claude-plugin/marketplace.json'), 1)
  assert.equal(count('profiles/balanced.md'), 1)
  assert.equal(count('profiles/codex-balanced.md'), 1)
  assert.equal(count('profiles/index.json'), 1)
  const pin = readPin(repo)
  assert.equal(pin.commit, sha)
  assert.deepEqual(readdirSync(path.join(repo, 'scripts', 'lib')).sort(), ['pin.mjs', 'remote.mjs'])
  const marked = hits.length
  const again = await pipeInitAsync(repo, home, [], {
    PSTACK_CATALOG: '',
    PSTACK_RAW: `http://127.0.0.1:${port}`,
    PSTACK_API: `http://127.0.0.1:${port}`,
  })
  const rest = hits.slice(marked)
  assert.equal(again.status, 0, `${again.stderr}\n${rest.join('\n')}`)
  assert.ok(rest.length > 0)
  const next = readPin(repo)
  assert.equal(next.profile, 'balanced')
  assert.equal(next.codexProfile, 'codex-balanced')
  const body = rest.filter((hit) => hit !== '/main/scripts/lib/remote.mjs')
  assert.ok(body.every((hit) => hit.startsWith(`/${next.commit}/`)))
  assert.equal(body.filter((hit) => hit.endsWith('/profiles/index.json')).length, 1)
  assert.equal(body.filter((hit) => hit.endsWith('.claude-plugin/marketplace.json')).length, 1)
  assert.equal(rest.some((hit) => hit.split('/').includes('main') && hit !== '/main/scripts/lib/remote.mjs'), false)
})

test('a second init with no flags keeps the pinned profiles', (t) => {
  const { home, repo } = fresh(t)
  const first = pipeInit(repo, home, ['--profile', 'lean', '--codex-profile', 'codex-lean'])
  assert.equal(first.status, 0, first.stderr)
  const again = pipeInit(repo, home, [], { PSTACK_PROFILE: 'max' })
  assert.equal(again.status, 0, again.stderr)
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.profile, 'lean')
  assert.equal(pin.codexProfile, 'codex-lean')
  assert.equal(settings(repo).model, 'sonnet')
})

test('init writes at the git root and falls back to cwd', (t) => {
  const { home, repo } = fresh(t)
  const sub = path.join(repo, 'nested')
  mkdirSync(sub)
  const init = pipeInit(sub, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(existsSync(path.join(repo, 'AGENTS.md')), true)
  assert.equal(existsSync(path.join(sub, 'AGENTS.md')), false)
  const trusted = JSON.parse(readFileSync(path.join(home, '.claude.json'), 'utf8'))
  assert.equal(trusted.projects[path.resolve(repo)].hasTrustDialogAccepted, true)
  const plainHome = mkdtempSync(path.join(tmpdir(), 'pstack-home-'))
  const plain = mkdtempSync(path.join(tmpdir(), 'pstack-plain-'))
  t.after(() => {
    rmSync(plainHome, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  })
  cpSync(path.join(home, 'bin'), path.join(plainHome, 'bin'), { recursive: true })
  const loose = pipeInit(plain, plainHome)
  assert.equal(loose.status, 0, loose.stderr)
  assert.equal(existsSync(path.join(plain, '.claude', 'pstack-claude-pin.json')), true)
})

test('pretty claude.json keeps its indent', (t) => {
  const { home, repo } = fresh(t)
  const claude = [
    '{',
    '    "numStartups": 4,',
    '',
    '    "projects": {',
    '        "/other": {',
    '            "extra": 1',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n')
  const file = path.join(home, '.claude.json')
  writeFileSync(file, claude)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  const next = readFileSync(file, 'utf8')
  assert.match(next, /^ {4}"numStartups": 4,$/m)
  assert.match(next, /^ {12}"extra": 1$/m)
  const parsed = JSON.parse(next)
  assert.equal(parsed.numStartups, 4)
  assert.equal(parsed.projects['/other'].extra, 1)
  assert.equal(parsed.projects[path.resolve(repo)].hasTrustDialogAccepted, true)
  assert.equal(readdirSync(home).some((name) => name.endsWith('.tmp')), false)
  const saved = next
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(file, 'utf8'), saved)
})

test('sessionSettings tolerates model lists, empty entries, and later session rows as main did', () => {
  for (const sheet of [
    'main session: sonnet @high, opus @xhigh',
    'main session: , sonnet @high, , opus @xhigh,',
    'main session: opus @low\nmain session: sonnet @high',
  ]) assert.deepEqual(sessionSettings(sheet), { model: 'sonnet', effort: 'high' })
  for (const sheet of ['feature: sonnet @high', 'main session: auto @high', 'main session: inherit-parent @high', 'main session: sonnet @nope']) {
    assert.throws(() => sessionSettings(sheet), /main session/)
  }
})

test('--ask-permissions removes only bypass values from old-layout settings', (t) => {
  const { home, repo } = fresh(t)
  mkdirSync(path.join(repo, '.claude'))
  mkdirSync(path.join(repo, '.codex'))
  writeFileSync(path.join(repo, 'AGENTS.md'), `# Product\n\n${COMBINED_MARKER}`)
  writeFileSync(path.join(repo, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions', allow: CHECK_RULES, deny: ['Write'], additionalDirectories: ['../shared'] },
    theme: 'dark',
  }))
  const config = 'approval_policy = "never" # init\nsandbox_mode = "read-only" # user\ncustom = true\n\nstory = """\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n"""\n\n[profiles.mine]\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n'
  writeFileSync(path.join(repo, '.codex', 'config.toml'), config)
  const init = pipeInit(repo, home, ['--ask-permissions'])
  assert.equal(init.status, 0, init.stderr)
  assert.deepEqual(settings(repo).permissions, { allow: CHECK_RULES, deny: ['Write'], additionalDirectories: ['../shared'] })
  assert.equal(settings(repo).theme, 'dark')
  const next = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(next, /^sandbox_mode = "read-only" # user$/m)
  assert.match(next, /^custom = true$/m)
  assert.ok(next.includes(config.slice(config.indexOf('story ='), config.indexOf('[profiles.mine]')).trimEnd()))
  assert.ok(next.includes(config.slice(config.indexOf('[profiles.mine]'))))
  assert.doesNotMatch(next, /^approval_policy = "never" # init$/m)
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), `# Product\n\n${COMBINED_MARKER}`)
  const before = snapshot(repo, home)
  assert.equal(pipeInit(repo, home, ['--ask-permissions']).status, 0)
  assertSameBytes(before, snapshot(repo, home))
})

test('marketplace tables use quoted keys and update old bare tables once', (t) => {
  const { home, repo } = fresh(t)
  mkdirSync(path.join(repo, '.codex'))
  writeFileSync(path.join(repo, '.codex', 'config.toml'), '[marketplaces.pstack-claude-catalog] # old init\nsource_type = "git"\nref = "old"\n')
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  const config = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(config, /\[marketplaces\."pstack-claude-catalog"\]/)
  assert.doesNotMatch(config, /\[marketplaces\.pstack-claude-catalog\]/)
  assert.equal((config.match(/source_type = "git"/g) || []).length, 1)
  const before = snapshot(repo, home)
  assert.equal(pipeInit(repo, home).status, 0)
  assertSameBytes(before, snapshot(repo, home))
})

test('init preserves a foreign legacy checker and gives known old checkers a compatibility shim', (t) => {
  for (const ours of [false, true]) {
    const { home, repo } = fresh(t)
    mkdirSync(path.join(repo, 'scripts'))
    const old = path.join(repo, 'scripts/check-pstack.mjs')
    const foreign = '#!/usr/bin/env node\n// Grok tree check\nconsole.log("grok sentinel")\n'
    writeFileSync(old, ours ? readFileSync(path.join(ROOT, 'scripts/pstack-claude-check.mjs'), 'utf8').replace('// pstack-claude-catalog: managed consumer script\n', '') : foreign)
    mkdirSync(path.join(repo, '.claude'))
    writeFileSync(path.join(repo, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(node scripts/check-pstack.mjs:*)', 'Bash(git status:*)'] } }))
    const init = pipeInit(repo, home)
    assert.equal(init.status, 0, init.stderr)
    assert.equal(settings(repo).permissions.allow.includes('Bash(node scripts/check-pstack.mjs:*)'), true)
    assert.ok(settings(repo).permissions.allow.includes('Bash(git status:*)'))
    assert.ok(settings(repo).permissions.allow.includes(CHECK_RULES[0]))
    assert.equal(existsSync(old), true)
    if (ours) assert.equal(readFileSync(old, 'utf8'), readFileSync(path.join(ROOT, 'scripts/check-pstack.mjs'), 'utf8'))
    if (!ours) assert.equal(readFileSync(old, 'utf8'), foreign)
    assert.equal(existsSync(path.join(repo, 'scripts/pstack-claude-check.mjs')), true)
  }
})

test('readPin rejects missing and malformed profile fields instead of coercing them', (t) => {
  const { repo } = fresh(t)
  mkdirSync(path.join(repo, '.claude'))
  const pin = { repo: 'https://github.com/anas-yousef/pstack-claude-catalog', commit: MAIN, profile: 'balanced', codexProfile: 'codex-balanced', plugins: ['pstack'] }
  for (const field of ['profile', 'codexProfile']) {
    for (const value of [undefined, null, true, 123, [], ['balanced'], {}, '', 'bad profile']) {
      writeFileSync(path.join(repo, '.claude/pstack-claude-pin.json'), JSON.stringify({ ...pin, [field]: value }))
      assert.throws(() => readPin(repo), /profile names/, field + ': ' + JSON.stringify(value))
    }
  }
})


test('writePin defaults only an omitted Codex profile and validates before writing', (t) => {
  const { repo } = fresh(t)
  const pin = { repo: 'https://github.com/anas-yousef/pstack-claude-catalog', commit: MAIN, profile: 'balanced', plugins: ['pstack'] }
  writePin(repo, pin)
  assert.equal(readPin(repo).codexProfile, 'codex-balanced')
  const before = readFileSync(path.join(repo, '.claude/pstack-claude-pin.json'), 'utf8')
  for (const codexProfile of [null, true, 123, [], ['balanced'], {}, '', 'bad profile']) {
    assert.throws(() => writePin(repo, { ...pin, codexProfile }), /profile names/)
    assert.equal(readFileSync(path.join(repo, '.claude/pstack-claude-pin.json'), 'utf8'), before)
  }
})

test('init installs pinned plugins through the CLI and reports install failures', (t) => {
  const { home, repo } = fresh(t)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.deepEqual(readFileSync(path.join(home, 'codex-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse), [
    ['--version'],
    ['plugin', 'marketplace', 'upgrade', 'pstack-claude-catalog', '--json'],
    ['plugin', 'add', 'pstack@pstack-claude-catalog', '--json'],
    ['plugin', 'add', 'pstack-extras@pstack-claude-catalog', '--json'],
  ])
  assert.deepEqual(readFileSync(path.join(home, 'claude-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse), [
    ['--version'],
    ['plugin', 'marketplace', 'add', 'anas-yousef/pstack-claude-catalog', '--scope', 'project'],
    ['plugin', 'install', 'pstack@pstack-claude-catalog', '--scope', 'project'],
    ['plugin', 'install', 'pstack-extras@pstack-claude-catalog', '--scope', 'project'],
  ])
  for (const fail of ['marketplace upgrade', 'plugin add']) {
    const failed = pipeInit(repo, home, [], { PSTACK_TEST_CODEX_FAIL: fail })
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /fixture install failure/)
  }
  const claudeFailure = pipeInit(repo, home, [], { PSTACK_TEST_CLAUDE_FAIL: 'plugin install' })
  assert.notEqual(claudeFailure.status, 0)
  assert.match(claudeFailure.stderr, /claude plugin install.*fixture install failure/)
  assert.equal(pipeInit(repo, home).status, 0)
})

test('init honors a conflicting directory marketplace without changing user settings bytes', (t) => {
  for (const ask of [false, true]) {
    const { home, repo } = fresh(t)
    const configDir = path.join(home, ask ? 'custom-claude' : '.claude')
    const userFile = path.join(configDir, 'settings.json')
    const directory = path.join(home, 'my marketplace')
    mkdirSync(configDir)
    mkdirSync(directory)
    const user = {
      theme: 'dark',
      permissions: ask ? {} : { defaultMode: 'bypassPermissions' },
      extraKnownMarketplaces: { 'pstack-claude-catalog': { source: { source: 'directory', path: directory } } },
    }
    const before = Buffer.from(JSON.stringify(user, null, '\t') + '\r\n')
    writeFileSync(userFile, before)
    const result = pipeInit(repo, home, ask ? ['--ask-permissions'] : [], { CLAUDE_CONFIG_DIR: configDir })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(userFile), before)
    assert.equal(result.stdout, `note: ${userFile} declares marketplace pstack-claude-catalog from directory ${directory}; init uses it and leaves it unchanged. Remove that entry to use the project's github source.\n`)
    const calls = readFileSync(path.join(home, 'claude-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls, [
      ['--version'],
      ['plugin', 'marketplace', 'add', 'anas-yousef/pstack-claude-catalog', '--scope', 'project'],
      ['plugin', 'marketplace', 'add', directory, '--scope', 'user'],
      ['plugin', 'install', 'pstack@pstack-claude-catalog', '--scope', 'project'],
      ['plugin', 'install', 'pstack-extras@pstack-claude-catalog', '--scope', 'project'],
    ])
  }
})

test('init preserves symlinked user settings and their target bytes after marketplace registration', (t) => {
  const { home, repo } = fresh(t)
  const userFile = path.join(home, '.claude/settings.json')
  const target = path.join(home, 'shared-settings.json')
  mkdirSync(path.dirname(userFile))
  const before = Buffer.from(JSON.stringify({
    theme: 'dark',
    permissions: { defaultMode: 'bypassPermissions' },
    extraKnownMarketplaces: { 'pstack-claude-catalog': { source: { source: 'directory', path: home } } },
  }, null, '\t') + '\r\n')
  writeFileSync(target, before, { mode: 0o640 })
  symlinkSync(target, userFile)
  const mode = statSync(target).mode
  const result = pipeInit(repo, home)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(lstatSync(userFile).isSymbolicLink(), true)
  assert.equal(readlinkSync(userFile), target)
  assert.deepEqual(readFileSync(target), before)
  assert.deepEqual(readFileSync(userFile), before)
  assert.equal(statSync(target).mode, mode)
})

test('init updates symlinked user settings while preserving the link and mode', (t) => {
  const { home, repo } = fresh(t)
  const userFile = path.join(home, '.claude/settings.json')
  const target = path.join(home, 'shared-settings.json')
  mkdirSync(path.dirname(userFile))
  writeFileSync(target, JSON.stringify({ permissions: { allow: ['Read'] } }), { mode: 0o600 })
  symlinkSync(target, userFile)
  const result = pipeInit(repo, home)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(lstatSync(userFile).isSymbolicLink(), true)
  assert.equal(readlinkSync(userFile), target)
  assert.deepEqual(JSON.parse(readFileSync(target)).permissions, { allow: ['Read'], defaultMode: 'bypassPermissions' })
  assert.equal(statSync(target).mode & 0o777, 0o600)
})

test('init reports managed conflicts when the user marketplace is absent or canonical', (t) => {
  for (const canonical of [false, true]) {
    const { home, repo } = fresh(t)
    mkdirSync(path.join(home, '.claude'))
    writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({
      extraKnownMarketplaces: canonical ? { 'pstack-claude-catalog': { source: { source: 'github', repo: 'anas-yousef/pstack-claude-catalog' } } } : {},
    }))
    const result = pipeInit(repo, home, [], { PSTACK_TEST_CLAUDE_MANAGED_CONFLICT: '1' })
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes('pstack-claude-catalog is declared with a different source in managed settings; ask your administrator, or remove that entry (https://code.claude.com/docs/en/settings#settings-precedence)'), result.stderr)
    const calls = readFileSync(path.join(home, 'claude-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls, [
      ['--version'],
      ['plugin', 'marketplace', 'add', 'anas-yousef/pstack-claude-catalog', '--scope', 'project'],
    ])
  }
})

test('failed user marketplace registration restores user settings bytes', (t) => {
  const { home, repo } = fresh(t)
  const file = path.join(home, '.claude/settings.json')
  mkdirSync(path.dirname(file))
  const before = Buffer.from(JSON.stringify({
    theme: 'dark',
    permissions: { defaultMode: 'bypassPermissions' },
    extraKnownMarketplaces: { 'pstack-claude-catalog': { source: { source: 'directory', path: home } } },
  }, null, '\t') + '\r\n')
  writeFileSync(file, before)
  const result = pipeInit(repo, home, [], { PSTACK_TEST_CLAUDE_FAIL: '--scope user' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Claude plugin setup failed \(Codex setup completed\).*--scope user failed: fixture install failure/)
  assert.deepEqual(readFileSync(file), before)
})

test('an unsupported marketplace source names the settings file and key', (t) => {
  const { home, repo } = fresh(t)
  const file = path.join(home, '.claude/settings.json')
  mkdirSync(path.dirname(file))
  const before = JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions' },
    extraKnownMarketplaces: { 'pstack-claude-catalog': { source: { source: 'npm', package: 'marketplace' } } },
  }, null, '\t')
  writeFileSync(file, before)
  const result = pipeInit(repo, home)
  assert.notEqual(result.status, 0)
  assert.ok(result.stderr.includes(file), result.stderr)
  assert.match(result.stderr, /extraKnownMarketplaces.*pstack-claude-catalog.*npm/)
  assert.match(result.stderr, /[Rr]emove or change/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('Claude command failures still complete Codex setup in CODEX_HOME', (t) => {
  for (const fail of ['plugin install', 'marketplace add']) {
    const { home, repo } = fresh(t)
    const codexHome = path.join(home, 'custom-codex')
    const result = pipeInit(repo, home, [], { CODEX_HOME: codexHome, PSTACK_TEST_CLAUDE_FAIL: fail })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /^Claude plugin setup failed \(Codex setup completed\): claude plugin .*fixture install failure/)
    assert.match(readFileSync(path.join(repo, '.codex/pstack-models.md'), 'utf8'), /Profile: codex-balanced/)
    assert.match(readFileSync(path.join(repo, '.codex/config.toml'), 'utf8'), /approval_policy = "never"/)
    const trust = readFileSync(path.join(codexHome, 'config.toml'), 'utf8')
    assert.ok(trust.includes(`[projects."${repo}"]\ntrust_level = "trusted"`), trust)
    assert.equal(existsSync(path.join(home, '.codex/config.toml')), false)
    const calls = readFileSync(path.join(home, 'codex-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(calls, [
      ['--version'],
      ['plugin', 'marketplace', 'upgrade', 'pstack-claude-catalog', '--json'],
      ['plugin', 'add', 'pstack@pstack-claude-catalog', '--json'],
      ['plugin', 'add', 'pstack-extras@pstack-claude-catalog', '--json'],
    ])
  }
})

test('Claude failure reports that Codex setup was skipped when its CLI is absent', (t) => {
  const { home, repo } = fresh(t)
  rmSync(path.join(home, 'bin/codex'))
  const result = pipeInit(repo, home, [], { PATH: path.join(home, 'bin'), PSTACK_TEST_CLAUDE_FAIL: 'plugin install' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /^Claude plugin setup failed \(Codex setup skipped: Codex CLI not found\): claude plugin .*fixture install failure/)
  assert.equal(existsSync(path.join(repo, '.codex')), false)
})

test('init reports both Claude and Codex setup failures, Claude first', (t) => {
  const { home, repo } = fresh(t)
  const result = pipeInit(repo, home, [], { PSTACK_TEST_CLAUDE_FAIL: 'plugin install', PSTACK_TEST_CODEX_FAIL: 'marketplace upgrade' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /^Claude plugin setup failed: claude plugin .*fixture install failure; Codex setup failed: codex plugin .*fixture install failure/)
})

test('init rewrites a legacy project git marketplace to github and is byte-identical on rerun', (t) => {
  const { home, repo } = fresh(t)
  const claudeFile = path.join(repo, '.claude/settings.json')
  const codexFile = path.join(repo, '.codex/config.toml')
  mkdirSync(path.dirname(claudeFile))
  writeFileSync(claudeFile, JSON.stringify({
    extraKnownMarketplaces: { 'pstack-claude-catalog': { source: { source: 'git', url: 'https://github.com/anas-yousef/pstack-claude-catalog.git' } } },
  }))
  const first = pipeInit(repo, home)
  assert.equal(first.status, 0, first.stderr)
  assert.deepEqual(settings(repo).extraKnownMarketplaces['pstack-claude-catalog'].source, {
    source: 'github', repo: 'anas-yousef/pstack-claude-catalog',
  })
  const before = [claudeFile, codexFile].map((file) => readFileSync(file))
  const second = pipeInit(repo, home)
  assert.equal(second.status, 0, second.stderr)
  assert.deepEqual([claudeFile, codexFile].map((file) => readFileSync(file)), before)
})

test('CLI preflight errors stop init before writing any project or user settings', (t) => {
  const { home, repo } = fresh(t)
  const before = snapshot(repo, home)
  const result = pipeInit(repo, home, [], { PSTACK_TEST_CODEX_FAIL: '--version' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /codex --version failed/)
  assertSameBytes(before, snapshot(repo, home))
})

test('init refuses foreign managed destinations and symlinks without replacing them', (t) => {
  for (const rel of ['scripts/pstack-claude-check.mjs', 'scripts/lib/pin.mjs', 'scripts/lib/remote.mjs']) {
    const { home, repo } = fresh(t)
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    writeFileSync(path.join(repo, rel), 'foreign sentinel\n')
    const result = pipeInit(repo, home)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to overwrite foreign file/)
    assert.equal(readFileSync(path.join(repo, rel), 'utf8'), 'foreign sentinel\n')
    assert.equal(existsSync(path.join(repo, '.claude/pstack-claude-pin.json')), false)
  }
  const { home, repo } = fresh(t)
  symlinkSync(home, path.join(repo, 'scripts'))
  const result = pipeInit(repo, home)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /symlink/)
  assert.equal(existsSync(path.join(home, 'pstack-claude-check.mjs')), false)
})


test('init skips all Codex setup when the CLI is absent and still installs Claude', (t) => {
  const { home, repo } = fresh(t)
  rmSync(path.join(home, 'bin/codex'))
  const result = pipeInit(repo, home, [], { PATH: path.join(home, 'bin') })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Codex CLI not found; skipping Codex setup/)
  assert.equal(existsSync(path.join(repo, '.codex')), false)
  assert.equal(existsSync(path.join(home, '.codex')), false)
  assert.equal(existsSync(path.join(repo, '.claude/pstack-models.md')), true)
  assert.match(readFileSync(path.join(home, 'claude-calls.jsonl'), 'utf8'), /"install"/)
})

test('Claude bypass uses user settings, preserves unrelated settings, and opts out on rerun', (t) => {
  const { home, repo } = fresh(t)
  const user = path.join(home, '.claude/settings.json')
  mkdirSync(path.dirname(user))
  writeFileSync(user, JSON.stringify({ theme: 'dark', permissions: { allow: ['Read'], deny: ['Write'], defaultMode: 'plan' } }))
  mkdirSync(path.join(repo, '.claude'))
  writeFileSync(path.join(repo, '.claude/settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }))
  const first = pipeInit(repo, home)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(settings(repo).permissions.defaultMode, undefined)
  assert.deepEqual(JSON.parse(readFileSync(user)), { theme: 'dark', permissions: { allow: ['Read'], deny: ['Write'], defaultMode: 'bypassPermissions' } })
  const optOut = pipeInit(repo, home, ['--ask-permissions'])
  assert.equal(optOut.status, 0, optOut.stderr)
  assert.deepEqual(JSON.parse(readFileSync(user)), { theme: 'dark', permissions: { allow: ['Read'], deny: ['Write'] } })
})

test('ownership hashes refuse edited scripts even if they retain every identifying snippet', (t) => {
  for (const rel of ['scripts/pstack-claude-check.mjs', 'scripts/lib/pin.mjs', 'scripts/lib/remote.mjs']) {
    const { home, repo } = fresh(t)
    assert.equal(pipeInit(repo, home).status, 0)
    const file = path.join(repo, rel)
    const edited = readFileSync(file, 'utf8') + '\n// Consumer fork: keep this change.\n'
    writeFileSync(file, edited)
    const before = snapshot(repo, home)
    const result = pipeInit(repo, home)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refusing to overwrite foreign file/)
    assertSameBytes(before, snapshot(repo, home))
  }
})

test('installed ownership records support upgrades without matching source snippets', (t) => {
  const { home, repo } = fresh(t)
  assert.equal(pipeInit(repo, home).status, 0)
  const catalog = mkdtempSync(path.join(tmpdir(), 'pstack-owned-'))
  t.after(() => rmSync(catalog, { recursive: true, force: true }))
  for (const rel of ['profiles', 'scripts', '.claude-plugin']) cpSync(path.join(ROOT, rel), path.join(catalog, rel), { recursive: true })
  const rel = 'scripts/pstack-claude-check.mjs'
  const next = '#!/usr/bin/env node\nconsole.log("new checker version")\n'
  writeFileSync(path.join(catalog, rel), next)
  const manifest = JSON.parse(readFileSync(path.join(catalog, 'scripts/lib/owned.json')))
  manifest.files[rel] = { sha256: createHash('sha256').update(next).digest('hex'), previous: [] }
  writeFileSync(path.join(catalog, 'scripts/lib/owned.json'), JSON.stringify(manifest))
  const upgrade = pipeInit(repo, home, [], { PSTACK_CATALOG: catalog })
  assert.equal(upgrade.status, 0, upgrade.stderr)
  assert.equal(readFileSync(path.join(repo, rel), 'utf8'), next)
  const installed = JSON.parse(readFileSync(path.join(repo, '.claude/pstack-claude-owned.json')))
  assert.equal(installed.files[rel], manifest.files[rel].sha256)
  assert.equal(pipeInit(repo, home, [], { PSTACK_CATALOG: catalog }).status, 0)
})

test('catalog ownership manifest hashes match the shipped files', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'scripts/lib/owned.json')))
  assert.equal(manifest.version, 1)
  for (const [rel, entry] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex'), entry.sha256, rel)
    assert.ok(entry.previous.every((version) => /^[a-f0-9]{64}$/.test(version.sha256) && /^[a-f0-9]{40}$/.test(version.commit)))
  }
})

test('a worktree trusts the main checkout for Claude and the consumer for Codex', (t) => {
  const { home, repo } = fresh(t)
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'base'], repo)
  const worktree = path.join(repo, 'linked')
  git(['worktree', 'add', '-qb', 'linked', worktree], repo)
  const result = pipeInit(worktree, home)
  assert.equal(result.status, 0, result.stderr)
  const trust = JSON.parse(readFileSync(path.join(home, '.claude.json')))
  assert.equal(trust.projects[repo]?.hasTrustDialogAccepted, true)
  const codex = readFileSync(path.join(home, '.codex/config.toml'), 'utf8')
  assert.ok(codex.includes(`[projects."${worktree}"]`))
})

test('project default mode does not mask the user bypass default', (t) => {
  for (const ask of [false, true]) {
    const { home, repo } = fresh(t)
    mkdirSync(path.join(repo, '.claude'))
    writeFileSync(path.join(repo, '.claude/settings.json'), JSON.stringify({ permissions: { defaultMode: 'default', deny: ['Read(.env)'] } }))
    const result = pipeInit(repo, home, ask ? ['--ask-permissions'] : [])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(settings(repo).permissions.defaultMode, ask ? 'default' : undefined)
    assert.deepEqual(settings(repo).permissions.deny, ['Read(.env)'])
  }
})
