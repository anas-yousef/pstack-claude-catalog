import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog.git'

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60000 })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}: ${result.error || result.stderr}`)
  return result.stdout
}

async function skills(repo, env) {
  const child = spawn('codex', ['app-server'], { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const lines = createInterface({ input: child.stdout })
  const pending = new Map()
  let sequence = 0
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  const timeout = setTimeout(() => {
    for (const waiter of pending.values()) waiter.reject(new Error(`app-server timed out: ${stderr}`))
    child.kill()
  }, 30000)
  try {
    await request('initialize', { clientInfo: { name: 'pstack-init-proof', version: '1' } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`)
    return await request('skills/list', { cwds: [repo], forceReload: true })
  } finally {
    clearTimeout(timeout)
    lines.close()
    child.kill()
  }
}

test('real Claude and Codex install both plugins on first run in an empty HOME and refresh the pin', { timeout: 180000 }, async (t) => {
  const work = mkdtempSync(path.join(tmpdir(), 'pstack-real-codex-'))
  t.after(() => rmSync(work, { recursive: true, force: true }))
  const home = path.join(work, 'home')
  const repo = path.join(work, 'consumer')
  const catalog = path.join(work, 'catalog')
  for (const dir of [home, repo, catalog]) mkdirSync(dir)
  const env = {
    ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'), PSTACK_CATALOG: catalog,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${catalog}.insteadOf`, GIT_CONFIG_VALUE_0: REPO,
  }
  delete env.XDG_CACHE_HOME
  delete env.CLAUDE_CONFIG_DIR
  delete env.XDG_CONFIG_HOME
  for (const rel of ['.claude-plugin', 'profiles', 'scripts', 'plugins']) {
    cpSync(path.join(ROOT, rel), path.join(catalog, rel), { recursive: true, filter: (file) => !file.split(path.sep).includes('node_modules') })
  }
  run('git', ['init', '-q'], catalog, env)
  run('git', ['add', '.'], catalog, env)
  run('git', ['commit', '-qm', 'catalog fixture'], catalog, env)
  const sha = run('git', ['rev-parse', 'HEAD'], catalog, env).trim()
  run('git', ['init', '-q'], repo, env)
  assert.deepEqual(readdirSync(home), [])
  const init = (commit = sha) => run(process.execPath, [path.join(ROOT, 'tools/init.mjs'), '--commit', commit], repo, env)
  init()
  t.diagnostic(run('claude', ['--version'], repo, env).trim())
  t.diagnostic(run('codex', ['--version'], repo, env).trim())
  const claude = JSON.parse(run('claude', ['plugin', 'list', '--json'], repo, env))
  assert.deepEqual(claude.map((plugin) => plugin.id).sort(), ['pstack-extras@pstack-claude-catalog', 'pstack@pstack-claude-catalog'])
  assert.ok(claude.every((plugin) => plugin.enabled && plugin.scope === 'project'))
  for (const plugin of claude) {
    assert.ok(readFileSync(path.join(plugin.installPath, '.claude-plugin/plugin.json'), 'utf8').includes('pstack'))
    assert.match(run('claude', ['plugin', 'details', plugin.id], repo, env), plugin.id.startsWith('pstack@') ? /poteto-mode/ : /greenfield/)
  }
  const project = JSON.parse(readFileSync(path.join(repo, '.claude/settings.json')))
  assert.deepEqual(project.extraKnownMarketplaces['pstack-claude-catalog'].source, {
    source: 'github', repo: 'anas-yousef/pstack-claude-catalog',
  })
  const user = JSON.parse(readFileSync(path.join(home, '.claude/settings.json')))
  assert.equal(project.permissions.defaultMode, undefined)
  assert.equal(user.permissions.defaultMode, 'bypassPermissions')
  const installed = JSON.parse(run('codex', ['plugin', 'list', '--json'], repo, env)).installed
  assert.deepEqual(installed.map((plugin) => plugin.name).sort(), ['pstack', 'pstack-extras'])
  assert.ok(installed.every((plugin) => plugin.installed && plugin.enabled))
  const loaded = (await skills(repo, env)).data.flatMap((entry) => entry.skills)
  for (const name of ['pstack:poteto-mode', 'pstack-extras:greenfield']) {
    assert.ok(loaded.some((skill) => skill.name === name && skill.enabled && skill.path.includes('/plugins/cache/pstack-claude-catalog/')), `missing loaded plugin skill ${name}`)
  }
  const projectFiles = ['.claude/settings.json', '.codex/config.toml']
  const beforeRerun = projectFiles.map((file) => readFileSync(path.join(repo, file)))
  init()
  assert.deepEqual(projectFiles.map((file) => readFileSync(path.join(repo, file))), beforeRerun)
  assert.deepEqual(JSON.parse(run('claude', ['plugin', 'list', '--json'], repo, env)), claude)
  assert.deepEqual(JSON.parse(run('codex', ['plugin', 'list', '--json'], repo, env)).installed, installed)
  assert.equal(JSON.parse(readFileSync(path.join(repo, '.claude/pstack-claude-pin.json'))).commit, sha)
  const skill = 'plugins/pstack-extras/skills/greenfield/SKILL.md'
  const updated = readFileSync(path.join(catalog, skill), 'utf8') + '\nPinned refresh sentinel.\n'
  writeFileSync(path.join(catalog, skill), updated)
  run('git', ['add', '.'], catalog, env)
  run('git', ['commit', '-qm', 'refresh fixture'], catalog, env)
  const next = run('git', ['rev-parse', 'HEAD'], catalog, env).trim()
  init(next)
  assert.equal(readFileSync(path.join(home, '.codex/plugins/cache/pstack-claude-catalog/pstack-extras/1.2.0/skills/greenfield/SKILL.md'), 'utf8'), updated)
  assert.equal(JSON.parse(readFileSync(path.join(repo, '.claude/pstack-claude-pin.json'))).commit, next)
  run(process.execPath, [path.join(ROOT, 'tools/init.mjs'), '--commit', next, '--ask-permissions'], repo, env)
  assert.equal(JSON.parse(readFileSync(path.join(home, '.claude/settings.json'))).permissions.defaultMode, undefined)
  assert.doesNotMatch(readFileSync(path.join(repo, '.codex/config.toml'), 'utf8'), /^approval_policy|^sandbox_mode/m)
  assert.equal(existsSync(path.join(repo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(repo, 'AGENTS.md'), 'utf8').match(/^@\.claude\/pstack-models\.md$/gm).length, 1)

  // Real Claude-only first run: PATH deliberately exposes no Codex executable.
  const claudeOnlyHome = path.join(work, 'claude-only-home')
  const claudeOnlyRepo = path.join(work, 'claude-only-consumer')
  const bin = path.join(work, 'claude-only-bin')
  for (const dir of [claudeOnlyHome, claudeOnlyRepo, bin]) mkdirSync(dir)
  for (const cli of ['git', 'claude']) symlinkSync(run('which', [cli], repo, env).trim(), path.join(bin, cli))
  const claudeOnlyEnv = { ...env, HOME: claudeOnlyHome, CODEX_HOME: path.join(claudeOnlyHome, '.codex'), PATH: bin }
  run('git', ['init', '-q'], claudeOnlyRepo, claudeOnlyEnv)
  const output = run(process.execPath, [path.join(ROOT, 'tools/init.mjs'), '--commit', next, '--ask-permissions'], claudeOnlyRepo, claudeOnlyEnv)
  assert.match(output, /Codex CLI not found; skipping Codex setup/)
  assert.equal(existsSync(path.join(claudeOnlyRepo, '.codex')), false)
  assert.equal(existsSync(path.join(claudeOnlyHome, '.codex')), false)
  const claudeOnly = JSON.parse(run('claude', ['plugin', 'list', '--json'], claudeOnlyRepo, claudeOnlyEnv))
  assert.equal(claudeOnly.length, 2)
  assert.ok(claudeOnly.every((plugin) => plugin.enabled && plugin.scope === 'project'))
  assert.equal(existsSync(path.join(claudeOnlyRepo, 'CLAUDE.md')), false)
  assert.equal(readFileSync(path.join(claudeOnlyRepo, 'AGENTS.md'), 'utf8').match(/^@\.claude\/pstack-models\.md$/gm).length, 1)
})
