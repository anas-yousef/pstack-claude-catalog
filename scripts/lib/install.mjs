import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fetchCatalogText, githubSlug } from './remote.mjs'
import { putPstack, sessionSettings } from './sheet.mjs'
import { writeConfig } from './toml.mjs'

const OLD_ALLOW = 'Bash(node scripts/check-pstack.mjs:*)'
const ALLOW = 'Bash(node scripts/pstack-claude-check.mjs:*)'
const EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const SLUG = /^[a-z0-9][a-z0-9-]*$/

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function marketplaceFrom(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('marketplace.json is not JSON')
  }
  if (!json || typeof json.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(json.name)) throw new Error('marketplace.json needs a plain name')
  if (!Array.isArray(json.plugins) || json.plugins.length === 0) throw new Error('marketplace.json needs plugins')
  const plugins = json.plugins.map((plugin) => {
    if (!plugin || typeof plugin.name !== 'string' || !SLUG.test(plugin.name)) throw new Error('marketplace plugin name is not a plain slug')
    return plugin.name
  })
  return { name: json.name, plugins }
}

function codexTables(pin, marketplace) {
  const tables = {
    [`marketplaces."${marketplace}"`]: {
      source_type: 'git',
      source: pin.repo.endsWith('.git') ? pin.repo : `${pin.repo}.git`,
      ref: pin.commit,
    },
  }
  for (const plugin of pin.plugins) tables[`plugins."${plugin}@${marketplace}"`] = { enabled: true }
  return tables
}

function readSettings(file) {
  if (!existsSync(file)) return { raw: '', current: {} }
  const raw = readFileSync(file, 'utf8')
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
    return { raw, current: parsed }
  } catch {
    writeFileSync(`${file}.bak`, raw)
    process.stdout.write(`backed up ${file} to ${file}.bak\n`)
    return { raw, current: {} }
  }
}

function writeSettings(file, session, pin, marketplace, askPermissions) {
  const { raw, current } = readSettings(file)
  current.model = session.model
  if (EFFORT.has(session.effort)) current.effortLevel = session.effort
  else delete current.effortLevel
  const permissions = asObject(current.permissions)
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((rule) => typeof rule === 'string') : []
  if (!allow.includes(ALLOW)) allow.push(ALLOW)
  if (!allow.includes(OLD_ALLOW)) allow.push(OLD_ALLOW)
  permissions.allow = allow
  if (permissions.defaultMode === 'bypassPermissions' || (!askPermissions && permissions.defaultMode === 'default')) delete permissions.defaultMode
  current.permissions = permissions
  const markets = asObject(current.extraKnownMarketplaces)
  markets[marketplace] = { source: { source: 'github', repo: githubSlug(pin.repo) } }
  current.extraKnownMarketplaces = markets
  const enabled = asObject(current.enabledPlugins)
  for (const plugin of pin.plugins) enabled[`${plugin}@${marketplace}`] = true
  current.enabledPlugins = enabled
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (next === raw) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}

function claudeFile() {
  return process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(homedir(), '.claude.json')
}

function claudeSettings() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), 'settings.json')
}

function userPermissions(askPermissions) {
  const file = claudeSettings()
  const { raw, parsed } = readClaude(file)
  const permissions = asObject(parsed.permissions)
  if (askPermissions) {
    if (permissions.defaultMode !== 'bypassPermissions') return
    delete permissions.defaultMode
  } else permissions.defaultMode = 'bypassPermissions'
  parsed.permissions = permissions
  const next = `${JSON.stringify(parsed, null, 2)}\n`
  if (next !== raw) writeAtomic(file, next)
}

function readClaude(file) {
  if (!existsSync(file)) return { raw: '', parsed: {} }
  const raw = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${file} is not JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} must be an object`)
  return { raw, parsed }
}

export function assertHomes() {
  readClaude(claudeFile())
  readClaude(claudeSettings())
  return { claude: available('claude'), codex: available('codex') }
}

function available(cli) {
  const result = spawnSync(cli, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error?.code === 'ENOENT') {
    process.stdout.write(`${cli === 'codex' ? 'Codex' : 'Claude'} CLI not found; skipping ${cli === 'codex' ? 'Codex setup' : 'Claude plugin installation'}; install ${cli} and rerun init\n`)
    return false
  }
  if (result.error || result.status !== 0) throw new Error(`${cli} --version failed: ${result.error?.message || result.stderr?.trim() || result.status}`)
  return true
}

function writeAtomic(file, text) {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

function trustClaude(repo) {
  // Claude keys worktree trust on the main checkout, not the linked worktree.
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo, encoding: 'utf8' })
  if (common.status === 0) {
    const gitDir = common.stdout.trim()
    if (path.basename(gitDir) === '.git') repo = realpathSync(path.dirname(gitDir))
  }
  const file = claudeFile()
  const { raw, parsed } = readClaude(file)
  parsed.projects = asObject(parsed.projects)
  const entry = asObject(parsed.projects[repo])
  entry.hasTrustDialogAccepted = true
  parsed.projects[repo] = entry
  const indent = raw.match(/\n(\t+| +)\S/)
  const unit = !raw || !indent ? 2 : (indent[1].includes('\t') ? '\t' : indent[1].length)
  const next = `${JSON.stringify(parsed, null, unit)}${!raw || raw.endsWith('\n') ? '\n' : ''}`
  if (next === raw) return
  writeAtomic(file, next)
}

function withProfiles(sheet, pin, profiles) {
  const url = `https://raw.githubusercontent.com/${githubSlug(pin.repo)}/${pin.commit}/profiles/<profile>.md`
  return `${sheet.trimEnd()}\n\nProfiles: ${profiles.join(', ')}. For this chat only, say "Use <profile> for this chat"; fetch ${url} over the network and override the installed role rows.\n`
}

export async function install(root, pin, claudeSheet, codexSheet, marketplace, askPermissions = false, clients = assertHomes()) {
  const profiles = JSON.parse(await fetchCatalogText(pin.repo, pin.commit, 'profiles/index.json'))
  const claudeDir = path.join(root, '.claude')
  const codexDir = path.join(root, '.codex')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(path.join(claudeDir, 'pstack-models.md'), withProfiles(claudeSheet, pin, profiles.filter((name) => !name.startsWith('codex-'))))
  writeSettings(path.join(claudeDir, 'settings.json'), sessionSettings(claudeSheet), pin, marketplace, askPermissions)
  userPermissions(askPermissions)
  const claudeMd = path.join(root, 'CLAUDE.md')
  const agentsMd = path.join(root, 'AGENTS.md')
  const separateClaude = existsSync(claudeMd) && (!existsSync(agentsMd) || realpathSync(claudeMd) !== realpathSync(agentsMd))
  if (separateClaude) putPstack(claudeMd, 'claude')
  putPstack(agentsMd, separateClaude ? 'codex' : clients.codex ? 'both' : 'claude')
  const abs = path.resolve(root)
  trustClaude(abs)
  if (clients.claude) {
    command('claude', root, ['plugin', 'marketplace', 'add', `${pin.repo}.git`, '--scope', 'project'])
    for (const plugin of pin.plugins) command('claude', root, ['plugin', 'install', `${plugin}@${marketplace}`, '--scope', 'project'])
  }
  if (!clients.codex) return
  mkdirSync(codexDir, { recursive: true })
  writeFileSync(path.join(codexDir, 'pstack-models.md'), withProfiles(codexSheet, pin, profiles.filter((name) => name.startsWith('codex-'))))
  const session = sessionSettings(codexSheet)
  const quoted = abs.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  writeConfig(path.join(codexDir, 'config.toml'), {
    root: {
      model: session.model,
      model_reasoning_effort: session.effort,
      ...(!askPermissions ? { approval_policy: 'never', sandbox_mode: 'danger-full-access' } : {}),
    },
    removeRoot: askPermissions ? { approval_policy: 'never', sandbox_mode: 'danger-full-access' } : {},
    tables: codexTables(pin, marketplace),
  })
  const home = process.env.CODEX_HOME || path.join(homedir(), '.codex')
  mkdirSync(home, { recursive: true })
  writeConfig(path.join(home, 'config.toml'), {
    tables: { [`projects."${quoted}"`]: { trust_level: 'trusted' } },
  })
  command('codex', root, ['plugin', 'marketplace', 'upgrade', marketplace, '--json'])
  for (const plugin of pin.plugins) command('codex', root, ['plugin', 'add', `${plugin}@${marketplace}`, '--json'])
}

function command(cli, root, args) {
  const result = spawnSync(cli, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) {
    throw new Error(`${cli} ${args.join(' ')} failed: ${result.error?.message || result.stderr?.trim() || result.stdout?.trim() || result.signal || result.status}`)
  }
}
