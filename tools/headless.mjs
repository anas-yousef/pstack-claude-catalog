#!/usr/bin/env node
// Opt-in integration proof: real CLIs, real network, existing auth, no session permission flags.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sessionSettings } from '../scripts/lib/sheet.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Codex refuses helper aliases beneath the OS temp directory. A unique directory
// under the user's home is still disposable, but supports the real CLI's helpers.
const work = mkdtempSync(path.join(process.env.PSTACK_PROOF_ROOT || homedir(), '.pstack-headless-'))
const catalog = path.join(work, 'catalog')
const claudeAuth = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), '.credentials.json')
const codexAuth = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'auth.json')
const homes = []
const baseEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Pstack proof', GIT_AUTHOR_EMAIL: 'proof@example.com',
  GIT_COMMITTER_NAME: 'Pstack proof', GIT_COMMITTER_EMAIL: 'proof@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: `url.${catalog}.insteadOf`,
  GIT_CONFIG_VALUE_0: 'https://github.com/anas-yousef/pstack-claude-catalog.git',
}
for (const key of ['CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CLAUDECODE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_CI', 'PSTACK_RAW', 'PSTACK_PROFILE']) delete baseEnv[key]
const events = (text) => text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))

function run(label, cli, args, cwd, env, input) {
  const result = spawnSync(cli, args, { cwd, env, input, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
  // Auth commands are deliberately never logged; all other stdout/stderr stays raw.
  if (!label.endsWith('-auth')) {
    writeFileSync(path.join(work, `${label}.stdout`), result.stdout || '')
    writeFileSync(path.join(work, `${label}.stderr`), result.stderr || '')
  }
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`)
  assert.equal(result.status, 0, `${label}: exit ${result.status}; see ${work}`)
  assert.doesNotMatch(result.stderr || '', /\bwarn(?:ing)?\b|not been trusted|permission denied/i, `${label}: stderr; see ${work}`)
  return result
}

function copyAuth(source, target) {
  assert.ok(existsSync(source), `Authenticate first; missing ${path.basename(source)}`)
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  cpSync(source, target)
  chmodSync(target, 0o600)
}

function consumer(name, api = false, linked = false, projectDefault = false) {
  const home = path.join(work, `${name}-home`)
  const repo = path.join(work, `${name}-repo`)
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(repo)
  homes.push(home)
  copyAuth(claudeAuth, path.join(home, '.claude/.credentials.json'))
  if (!api) copyAuth(codexAuth, path.join(home, '.codex/auth.json'))
  const env = { ...baseEnv, HOME: home, CODEX_HOME: path.join(home, '.codex'), PSTACK_CATALOG: catalog }
  run(`${name}-git`, 'git', ['init', '-q', '-b', 'main'], repo, env)
  let cwd = repo
  if (linked) {
    run(`${name}-base`, 'git', ['commit', '--allow-empty', '-qm', 'worktree base'], repo, env)
    cwd = path.join(work, `${name}-worktree`)
    run(`${name}-worktree`, 'git', ['worktree', 'add', '-qb', 'linked', cwd], repo, env)
  }
  if (api) {
    assert.ok(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is required for the API-auth proof')
    mkdirSync(env.CODEX_HOME, { recursive: true, mode: 0o700 })
    run(`${name}-auth`, 'codex', ['login', '--with-api-key'], cwd, env, process.env.OPENAI_API_KEY + '\n')
    console.log('codex api-key login=success auth_present=true')
  }
  if (projectDefault) {
    mkdirSync(path.join(cwd, '.claude'))
    writeFileSync(path.join(cwd, '.claude/settings.json'), JSON.stringify({ permissions: { defaultMode: 'default' } }))
  }
  assert.equal(existsSync(path.join(home, '.claude.json')), false)
  assert.equal(existsSync(path.join(home, '.codex/config.toml')), false)
  run(`${name}-init`, process.execPath, [path.join(root, 'tools/init.mjs'), '--commit', sha], cwd, env)
  const auth = JSON.parse(run(`${name}-claude-auth`, 'claude', ['auth', 'status'], cwd, env).stdout)
  assert.equal(auth.loggedIn, true)
  return { name, home, repo: cwd, env }
}

function prompt(c, cli) {
  const sentinel = path.join(work, `${c.name}-${cli}-full-access`)
  assert.equal(existsSync(sentinel), false)
  const command = `node -e 'require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "full-access")'`
  return {
    sentinel,
    text: `Verify this installer in this temporary repository. Do not invoke skills, delegate, or read credential files. Run node scripts/pstack-claude-check.mjs as one standalone shell command exactly once. Then run this separate command exactly once: ${command}. Read only the installed runtime model sheet. Explain which row controls this main session's reasoning effort and what the bug-fix row changes. Do not modify any repository files. Return the checker stdout and exit code verbatim.`,
  }
}

function claude(c) {
  const task = prompt(c, 'claude')
  const result = run(`${c.name}-claude`, 'claude', ['-p', task.text, '--output-format', 'stream-json', '--verbose'], c.repo, c.env)
  const messages = events(result.stdout)
  const init = messages.find((event) => event.type === 'system' && event.subtype === 'init')
  assert.equal(init.permissionMode, 'bypassPermissions')
  const final = messages.find((event) => event.type === 'result')
  assert.equal(final.is_error, false)
  assert.deepEqual(final.permission_denials, [])
  const commands = messages.flatMap((event) => event.type === 'assistant' ? event.message.content : []).filter((item) => item.type === 'tool_use' && item.name === 'Bash')
  assert.equal(commands.filter((item) => item.input.command === 'node scripts/pstack-claude-check.mjs').length, 1)
  const toolResults = messages.flatMap((event) => event.type === 'user' ? event.message.content : []).filter((item) => item.type === 'tool_result')
  assert.ok(toolResults.some((item) => JSON.stringify(item.content).match(/pstack: (current|outdated) \(exit [01]\)/)))
  assert.equal(readFileSync(task.sentinel, 'utf8'), 'full-access')
  assert.equal(result.stderr, '')
  console.log(`claude ${c.name} first_session=true permissionMode=${init.permissionMode} permission_denials=0 warnings=0 stderr_bytes=0`)
  for (const item of toolResults) {
    const line = JSON.stringify(item.content).match(/pstack: (?:current|outdated) \(exit [01]\)/)?.[0]
    if (line) console.log(line)
  }
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}

function codex(c) {
  const task = prompt(c, 'codex')
  const result = run(`${c.name}-codex`, 'codex', ['exec', '--json', task.text], c.repo, c.env)
  const messages = events(result.stdout)
  assert.ok(messages.some((event) => event.type === 'turn.completed'))
  assert.ok(!messages.some((event) => /error|warning|approval/.test(event.type)))
  const commands = messages.filter((event) => event.type === 'item.completed' && event.item.type === 'command_execution').map((event) => event.item)
  const checks = commands.filter((item) => /(?:^|[ '])node scripts\/pstack-claude-check\.mjs(?:$|')/.test(item.command))
  assert.equal(checks.length, 1)
  assert.match(checks[0].aggregated_output, /^pstack: (?:current|outdated) \(exit [01]\)\n$/)
  assert.equal(readFileSync(task.sentinel, 'utf8'), 'full-access')
  const contexts = files(path.join(c.home, '.codex/sessions')).flatMap((file) => events(readFileSync(file, 'utf8'))).filter((event) => event.type === 'turn_context')
  assert.equal(contexts.length, 1)
  const runtime = contexts[0].payload
  const expected = sessionSettings(readFileSync(path.join(c.repo, '.codex/pstack-models.md'), 'utf8'))
  assert.equal(runtime.sandbox_policy.type, 'danger-full-access')
  assert.equal(runtime.approval_policy, 'never')
  assert.equal(runtime.effort, expected.effort)
  assert.equal(runtime.model, expected.model)
  console.log(`codex ${c.name} first_session=true sandbox=${runtime.sandbox_policy.type} approval_policy=${runtime.approval_policy} model=${runtime.model} effort=${runtime.effort} approvals=0 warnings=0`)
  console.log(checks[0].aggregated_output.trimEnd())
}

let sha
try {
  for (const rel of ['.claude-plugin', 'profiles', 'scripts', 'plugins']) {
    cpSync(path.join(root, rel), path.join(catalog, rel), { recursive: true, filter: (file) => !file.split(path.sep).includes('node_modules') })
  }
  run('catalog-git', 'git', ['init', '-q', '-b', 'main'], catalog, baseEnv)
  run('catalog-add', 'git', ['add', '.'], catalog, baseEnv)
  run('catalog-commit', 'git', ['commit', '-qm', 'headless proof snapshot'], catalog, baseEnv)
  sha = run('catalog-sha', 'git', ['rev-parse', 'HEAD'], catalog, baseEnv).stdout.trim()
  const normal = consumer('copied-auth')
  claude(normal)
  codex(normal)
  claude(consumer('project-default', false, false, true))
  const linked = consumer('worktree', false, true)
  claude(linked)
  codex(linked)
  codex(consumer('api-auth', true))
} finally {
  console.log(`raw_logs=${work}`)
  // Raw session evidence remains; credentials and their session caches do not.
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  rmSync(catalog, { recursive: true, force: true })
}
