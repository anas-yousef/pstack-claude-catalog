import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { githubSlug } from './remote.mjs'
import { putPstack, sessionSettings } from './sheet.mjs'
import { writeConfig } from './toml.mjs'

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const ALLOW = 'Bash(node scripts/check-pstack.mjs:*)'
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
  const bare = /^[A-Za-z0-9_-]+$/.test(marketplace)
  const tables = {
    [bare ? `marketplaces.${marketplace}` : `marketplaces."${marketplace}"`]: {
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

function writeSettings(file, session, pin, marketplace) {
  const { raw, current } = readSettings(file)
  current.model = session.model
  if (EFFORT.has(session.effort)) current.effortLevel = session.effort
  else delete current.effortLevel
  const permissions = asObject(current.permissions)
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((rule) => typeof rule === 'string') : []
  if (!allow.includes(ALLOW)) allow.push(ALLOW)
  permissions.allow = allow
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
  return path.join(homedir(), '.claude.json')
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
  const file = claudeFile()
  const { raw, parsed } = readClaude(file)
  if (!asObject(parsed.projects) || Array.isArray(parsed.projects)) parsed.projects = {}
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

export function install(root, pin, claudeSheet, codexSheet, marketplace) {
  const claudeDir = path.join(root, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(path.join(claudeDir, 'pstack-models.md'), claudeSheet)
  writeSettings(path.join(claudeDir, 'settings.json'), sessionSettings(claudeSheet), pin, marketplace)
  const claudeMd = path.join(root, 'CLAUDE.md')
  if (existsSync(claudeMd)) putPstack(claudeMd)
  putPstack(path.join(root, 'AGENTS.md'))
  const session = sessionSettings(codexSheet)
  const abs = path.resolve(root)
  const quoted = abs.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  writeConfig(path.join(root, '.codex', 'config.toml'), {
    root: { model: session.model, model_reasoning_effort: session.effort },
    tables: codexTables(pin, marketplace),
  })
  const home = process.env.CODEX_HOME || path.join(homedir(), '.codex')
  mkdirSync(home, { recursive: true })
  writeConfig(path.join(home, 'config.toml'), {
    tables: { [`projects."${quoted}"`]: { trust_level: 'trusted' } },
  })
  trustClaude(abs)
}
