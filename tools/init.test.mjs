import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readPin } from '../scripts/lib/pin.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INIT = path.join(ROOT, 'tools', 'init.mjs')
const MAIN = 'bfd48a1b300dbad50f6ea2e30f4a3edbe9737943'
const CHECK_RULES = [
  'Bash(node scripts/check-pstack.mjs)',
  'Bash(node scripts/check-pstack.mjs *)',
]

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
  git(['init', '-q', '-b', 'main'], repo)
  return { home, repo }
}

function childEnv(home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, ...extraEnv }
  delete env.XDG_CACHE_HOME
  delete env.CODEX_HOME
  if (!Object.hasOwn(extraEnv, 'PSTACK_CATALOG')) delete env.PSTACK_CATALOG
  if (!Object.hasOwn(extraEnv, 'PSTACK_PROFILE')) delete env.PSTACK_PROFILE
  return env
}

function run(repo, home, script, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', env: childEnv(home, extraEnv) })
}

function pipeInit(repo, home, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, ['-', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: childEnv(home, { PSTACK_CATALOG: ROOT, ...extraEnv }),
    input: readFileSync(INIT),
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
  const homeBefore = '# kept\nmodel = "old-model"\nmodel_reasoning_effort = "low"\nsandbox_mode = "workspace-write"\n\n[features] # team\nmulti_agent = true\n\n[mcp_servers.local]\ncommand = "node"\n'
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
  assert.match(agentsMd, /<!-- pstack:begin -->\n@\.claude\/pstack-models\.md\nnode scripts\/check-pstack\.mjs\n<!-- pstack:end -->/)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
  assert.match(readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8'), /^Profile: balanced\./m)
  assert.match(readFileSync(path.join(home, '.codex', 'pstack-models.md'), 'utf8'), /^Profile: codex-balanced\./m)
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
  assert.equal(homeConfig, homeBefore)
  const repoSettings = readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')
  assert.match(homeConfig, /^# kept$/m)
  assert.match(homeConfig, /^sandbox_mode = "workspace-write"$/m)
  assert.match(homeConfig, /\[features\] # team\nmulti_agent = true/)
  assert.equal((homeConfig.match(/\[features\]/g) || []).length, 1)
  assert.match(homeConfig, /\[mcp_servers\.local\]\ncommand = "node"/)
  const homeAgents = readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8')
  assert.match(homeAgents, /^main session: gpt-6\.1-sol @high$/m)
  assert.match(homeAgents, /feature, refactoring: gpt-6\.1-sol @high/)
  assert.match(homeAgents, /^default effort: high$/m)
  assert.match(homeAgents, /^The effort listed for a role is a minimum\b/m)
  assert.doesNotMatch(homeAgents, /panel vendors/)
  assert.doesNotMatch(agentsMd, /gpt-6/)

  assert.deepEqual(readdirSync(path.join(repo, '.codex')).sort(), ['config.toml'])
  const projectConfig = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(projectConfig, /\[plugins\."pstack@pstack-claude-catalog"\]\nenabled = true/)
  assert.match(projectConfig, /\[plugins\."pstack-extras@pstack-claude-catalog"\]\nenabled = true/)
  assert.match(projectConfig, new RegExp(`ref = "${pin.commit}"`))

  const againClaude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'), [], { PSTACK_CATALOG: ROOT })
  const againCodex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'), [], { PSTACK_CATALOG: ROOT })
  assert.equal(againClaude.status, 0, againClaude.stderr)
  assert.equal(againCodex.status, 0, againCodex.stderr)
  assert.equal(againClaude.stdout, '')
  assert.equal(againCodex.stdout, '')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  assert.equal(readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), homeConfig)
  assert.equal(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'), repoSettings)
  assert.match(agentsMd, /node scripts\/check-pstack\.mjs/)
  const before = snapshot(repo, home)
  const second = pipeInit(repo, home)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout, '')
  assertSameBytes(before, snapshot(repo, home))
})

test('an AGENTS.md-only repo gets one pstack section and no CLAUDE.md', (t) => {
  const { home, repo } = fresh(t)
  const agentsBefore = '# Agents\n\nKeep this.\n'
  const marker = '<!-- pstack:begin -->\n@.claude/pstack-models.md\nnode scripts/check-pstack.mjs\n<!-- pstack:end -->\n'
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')
  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  const codex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'))
  assert.equal(claude.status, 0, claude.stderr)
  assert.equal(codex.status, 0, codex.stderr)
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.equal(agentsMd, `${agentsBefore}\n${marker}`)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)

  const reversedRepo = mkdtempSync(path.join(tmpdir(), 'pstack-repo-'))
  t.after(() => rmSync(reversedRepo, { recursive: true, force: true }))
  git(['init', '-q', '-b', 'main'], reversedRepo)
  writeFileSync(path.join(reversedRepo, 'AGENTS.md'), agentsBefore)
  assert.equal(run(reversedRepo, home, INIT).status, 0)
  assert.equal(run(reversedRepo, home, path.join(reversedRepo, 'scripts', 'setup-pstack-codex.mjs')).status, 0)
  assert.equal(run(reversedRepo, home, path.join(reversedRepo, 'scripts', 'setup-pstack-claude.mjs')).status, 0)
  assert.equal(readFileSync(path.join(reversedRepo, 'AGENTS.md'), 'utf8'), agentsMd)
})

test('an AGENTS.md include near the top stays the only include line', (t) => {
  const { home, repo } = fresh(t)
  const agentsBefore = '# Agents\n\n@.claude/pstack-models.md\n\nKeep this.\n'
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')
  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  assert.equal(claude.status, 0, claude.stderr)
  assert.equal(claude.stdout, '')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.equal((agentsMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.match(agentsMd, /<!-- pstack:begin -->\nnode scripts\/check-pstack\.mjs\n<!-- pstack:end -->/)
  const again = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
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
    permissions: { allow: ['Bash'], deny: ['Bash(rm *)'] },
    model: 'old',
    extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'acme/tools', ref: 'v1' } } },
  }, null, 2)}\n`)

  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  assert.equal(init.stdout, '')
  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  const codex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'))
  assert.equal(claude.status, 0, claude.stderr)
  assert.equal(codex.status, 0, codex.stderr)

  const claudeMd = readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8')
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  const marker = '<!-- pstack:begin -->\n@.claude/pstack-models.md\nnode scripts/check-pstack.mjs\n<!-- pstack:end -->\n'
  assert.ok(claudeMd.endsWith(`\n\n${marker}`))
  assert.ok(agentsMd.endsWith(`\n\n${marker}`))
  assert.doesNotMatch(claudeMd, /AGENTS\.md/)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
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
  assert.equal(parsed.theme, 'dark')
  assert.deepEqual(parsed.permissions.deny, ['Bash(rm *)'])
  assert.equal(parsed.permissions.allow[0], 'Bash')
  for (const rule of CHECK_RULES) assert.ok(parsed.permissions.allow.includes(rule), rule)
  assert.equal(parsed.extraKnownMarketplaces.other.source.ref, 'v1')
  assert.equal(parsed.extraKnownMarketplaces['pstack-claude-catalog'].source.repo, 'anas-yousef/pstack-claude-catalog')
  assert.equal(parsed.extraKnownMarketplaces['pstack-claude-catalog'].source.ref, undefined)
  assert.equal(parsed.enabledPlugins['pstack@pstack-claude-catalog'], true)
  const repoSettings = readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8')

  assert.equal(run(repo, home, INIT).status, 0)
  assert.equal(run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs')).status, 0)
  assert.equal(run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs')).status, 0)
  assert.equal(readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), claudeMd)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  assert.equal(readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8'), projectConfig)
  assert.equal(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'), repoSettings)
  assert.equal(readFileSync(skill, 'utf8'), 'product skill\n')
  assert.equal((claudeMd.match(/^## pstack$/gm) || []).length, 0)
  assert.match(claudeMd, /^## Product$|^# Product$/m)
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
  assert.match(readFileSync(path.join(home, '.codex', 'pstack-models.md'), 'utf8'), /^feature, refactoring: gpt-6-luna @low$/m)
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
    'alpha',
    'beta',
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
  assert.ok(project.includes('story = """\nalpha\nbeta\n"""\n'))
  assert.ok(project.includes(mcp))
  assert.match(project, /^model = "gpt-6\.1-sol" # mine$/m)
  assert.equal(readFileSync(homeFile, 'utf8'), tail)
  assert.equal(existsSync(`${homeFile}.bak`), false)
  const projectFile = path.join(repo, '.codex', 'config.toml')
  assert.equal(existsSync(`${projectFile}.bak`), false)
  const saved = readFileSync(projectFile, 'utf8')
  const again = pipeInit(repo, home)
  assert.equal(again.status, 0, again.stderr)
  assert.equal(readFileSync(projectFile, 'utf8'), saved)
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

test('check reports drift and stays quiet offline', (t) => {
  const { home, repo } = fresh(t)
  const init = pipeInit(repo, home)
  assert.equal(init.status, 0, init.stderr)
  const gitDir = path.join(repo, '.git')
  assert.equal(spawnSync('chmod', ['-R', 'a-w', gitDir]).status, 0)
  try {
    const check = run(repo, home, path.join(repo, 'scripts', 'check-pstack.mjs'))
    assert.equal(check.status, 0, check.stderr)
    assert.match(check.stdout, /^pin [0-9a-f]{40} catalog [0-9a-f]{40} current\n$/)
    const pinPath = path.join(repo, '.claude', 'pstack-claude-pin.json')
    const pin = JSON.parse(readFileSync(pinPath, 'utf8'))
    pin.commit = MAIN
    writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`)
    const drift = run(repo, home, path.join(repo, 'scripts', 'check-pstack.mjs'))
    assert.equal(drift.status, 1)
    assert.match(drift.stdout, new RegExp(`^pin ${MAIN} catalog [0-9a-f]{40} outdated\\n$`))
    pin.repo = 'https://github.com/anas-yousef/not-a-real-catalog-offline'
    pin.commit = MAIN
    writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`)
    const offline = run(repo, home, path.join(repo, 'scripts', 'check-pstack.mjs'))
    assert.equal(offline.status, 0, offline.stderr)
    assert.equal(offline.stdout, `pin ${MAIN} (offline: run outside the sandbox to compare)\n`)
  } finally {
    spawnSync('chmod', ['-R', 'u+w', gitDir])
  }
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
