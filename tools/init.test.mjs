import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INIT = path.join(ROOT, 'tools', 'init.mjs')
const MAIN = '860e1c1458b60c6568108f5d4d08830d570e01f4'

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

function run(repo, home, script, args = []) {
  const env = { ...process.env, HOME: home }
  delete env.XDG_CACHE_HOME
  delete env.CODEX_HOME
  return spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8', env })
}

function modelLines(home) {
  const text = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
  return text.split('\n').filter((line) => line.startsWith('model'))
}

test('a new repo installs both sheets and records the session model', (t) => {
  const { home, repo } = fresh(t)
  mkdirSync(path.join(home, '.codex'), { recursive: true })
  writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "old-model"\nmodel_reasoning_effort = "low"\n\n[features]\nmulti_agent = true\n')
  const init = run(repo, home, INIT)
  assert.equal(init.status, 0, init.stderr)
  const pin = JSON.parse(readFileSync(path.join(repo, '.claude', 'pstack-claude-pin.json'), 'utf8'))
  assert.equal(pin.repo, 'https://github.com/anas-yousef/pstack-claude-catalog')
  assert.match(pin.commit, /^[0-9a-f]{40}$/)
  assert.equal(pin.profile, 'balanced')
  assert.equal(pin.codexProfile, 'codex-balanced')
  assert.deepEqual(pin.plugins, ['pstack', 'pstack-extras'])
  assert.equal(existsSync(path.join(repo, 'plugins')), false)

  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  assert.equal(claude.status, 0, claude.stderr)
  assert.equal(claude.stdout, 'sheet ok\n')
  const codex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'))
  assert.equal(codex.status, 0, codex.stderr)
  assert.equal(codex.stdout, 'sheet ok\n')

  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.equal((agentsMd.match(/^## pstack$/gm) || []).length, 1)
  assert.match(agentsMd, /@\.claude\/pstack-models\.md/)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
  assert.match(readFileSync(path.join(repo, '.claude', 'pstack-models.md'), 'utf8'), /^Profile: balanced\./m)
  assert.match(readFileSync(path.join(home, '.codex', 'pstack-models.md'), 'utf8'), /^Profile: codex-balanced\./m)
  assert.equal(existsSync(path.join(home, '.cache', 'pstack-claude-catalog', pin.commit, 'profiles', 'balanced.md')), true)
  assert.equal(existsSync(path.join(repo, '.cache')), false)

  const lines = modelLines(home)
  console.log(`fresh-HOME config.toml\n${lines.join('\n')}`)
  assert.deepEqual(lines, ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])
  const homeConfig = readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
  assert.match(homeConfig, /\[features\]\nmulti_agent = true/)
  const homeAgents = readFileSync(path.join(home, '.codex', 'AGENTS.md'), 'utf8')
  assert.match(homeAgents, /feature, refactoring: gpt-6\.1-sol @high/)
  assert.match(homeAgents, /^default effort: high$/m)
  assert.match(homeAgents, /^The effort listed for a role is a minimum\b/m)
  assert.doesNotMatch(homeAgents, /panel vendors/)
  assert.doesNotMatch(agentsMd, /gpt-6/)

  const projectConfig = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(projectConfig, /\[plugins\."pstack@pstack-claude-catalog"\]\nenabled = true/)
  assert.match(projectConfig, /\[plugins\."pstack-extras@pstack-claude-catalog"\]\nenabled = true/)
  assert.match(projectConfig, new RegExp(`ref = "${pin.commit}"`))

  const againClaude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  const againCodex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'))
  assert.equal(againClaude.stdout, 'sheet ok\n')
  assert.equal(againCodex.stdout, 'sheet ok\n')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  assert.equal(readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), homeConfig)
  assert.equal((agentsMd.match(/^## pstack$/gm) || []).length, 1)
})

test('an AGENTS.md-only repo gets one pstack section and no CLAUDE.md', (t) => {
  const { home, repo } = fresh(t)
  const agentsBefore = '# Agents\n\nKeep this.\n'
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const init = run(repo, home, INIT)
  assert.equal(init.status, 0, init.stderr)
  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  const codex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'))
  assert.equal(claude.status, 0, claude.stderr)
  assert.equal(codex.status, 0, codex.stderr)
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.ok(agentsMd.startsWith(`${agentsBefore}\n## pstack\n`))
  assert.equal((agentsMd.match(/^## pstack$/gm) || []).length, 1)
  assert.match(agentsMd, /@\.claude\/pstack-models\.md/)
  assert.match(agentsMd, /setup-pstack-claude\.mjs/)
  assert.match(agentsMd, /Codex loads role models/)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)

  const reversedRepo = mkdtempSync(path.join(tmpdir(), 'pstack-repo-'))
  t.after(() => rmSync(reversedRepo, { recursive: true, force: true }))
  git(['init', '-q', '-b', 'main'], reversedRepo)
  writeFileSync(path.join(reversedRepo, 'AGENTS.md'), agentsBefore)
  assert.equal(run(reversedRepo, home, INIT).status, 0)
  assert.equal(run(reversedRepo, home, path.join(reversedRepo, 'scripts', 'setup-pstack-codex.mjs')).status, 0)
  assert.equal(run(reversedRepo, home, path.join(reversedRepo, 'scripts', 'setup-pstack-claude.mjs')).status, 0)
  assert.equal(existsSync(path.join(reversedRepo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(reversedRepo, 'AGENTS.md'), 'utf8'), agentsMd)

  assert.equal(run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs')).stdout, 'sheet ok\n')
  assert.equal(run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs')).stdout, 'sheet ok\n')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
})

test('an AGENTS.md include near the top stays the only include line', (t) => {
  const { home, repo } = fresh(t)
  const agentsBefore = '# Agents\n\n@.claude/pstack-models.md\n\nKeep this.\n'
  writeFileSync(path.join(repo, 'AGENTS.md'), agentsBefore)
  const init = run(repo, home, INIT)
  assert.equal(init.status, 0, init.stderr)
  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  assert.equal(claude.status, 0, claude.stderr)
  assert.equal(claude.stdout, 'sheet ok\n')
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.ok(agentsMd.startsWith(`${agentsBefore}\n## pstack\n`))
  assert.equal((agentsMd.match(/^@\.claude\/pstack-models\.md$/gm) || []).length, 1)
  assert.equal((agentsMd.match(/^## pstack$/gm) || []).length, 1)
  assert.match(agentsMd, /setup-pstack-claude\.mjs/)
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

  const init = run(repo, home, INIT)
  assert.equal(init.status, 0, init.stderr)
  const claude = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs'))
  const codex = run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs'))
  assert.equal(claude.stdout, 'sheet ok\n')
  assert.equal(codex.stdout, 'sheet ok\n')

  const claudeMd = readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8')
  const agentsMd = readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')
  assert.ok(claudeMd.startsWith('# Product\n\nKeep this.\n\n## pstack\n'))
  assert.ok(agentsMd.startsWith('# Agents\n\nKeep this too.\n\n## pstack\n'))
  assert.doesNotMatch(claudeMd, /AGENTS\.md/)
  assert.doesNotMatch(agentsMd, /CLAUDE\.md/)
  assert.equal(readFileSync(skill, 'utf8'), 'product skill\n')
  assert.equal(readFileSync(other, 'utf8'), 'other skill\n')
  const projectConfig = readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8')
  assert.match(projectConfig, /\[features\]\nmulti_agent = true/)
  assert.match(projectConfig, /enabled = true/)
  const lines = modelLines(home)
  console.log(`existing-repo fresh-HOME config.toml\n${lines.join('\n')}`)
  assert.deepEqual(lines, ['model = "gpt-6.1-sol"', 'model_reasoning_effort = "high"'])

  assert.equal(run(repo, home, INIT).status, 0)
  assert.equal(run(repo, home, path.join(repo, 'scripts', 'setup-pstack-claude.mjs')).stdout, 'sheet ok\n')
  assert.equal(run(repo, home, path.join(repo, 'scripts', 'setup-pstack-codex.mjs')).stdout, 'sheet ok\n')
  assert.equal(readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), claudeMd)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), agentsMd)
  assert.equal(readFileSync(path.join(repo, '.codex', 'config.toml'), 'utf8'), projectConfig)
  assert.equal(readFileSync(skill, 'utf8'), 'product skill\n')
  assert.equal((claudeMd.match(/^## pstack$/gm) || []).length, 1)
})

test('flags select the pin and a bad profile writes nothing', (t) => {
  const { home, repo } = fresh(t)
  const selected = run(repo, home, INIT, ['--profile', 'lean', '--codex-profile', 'codex-lean', '--commit', MAIN])
  assert.equal(selected.status, 0, selected.stderr)
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
