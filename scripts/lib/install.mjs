import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { codexTables } from './codex-config.mjs'
import { githubSlug } from './remote.mjs'
import { putPstack, sessionSettings } from './sheet.mjs'
import { writeConfig } from './toml.mjs'

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const ALLOW = 'Bash(node scripts/check-pstack.mjs)'

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
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
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((rule) => rule !== 'Bash(node scripts/check-pstack.mjs *)' && typeof rule === 'string') : []
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

function trustClaude(home, repo) {
  const file = path.join(home, '.claude.json')
  let current = {}
  let raw = ''
  if (existsSync(file)) {
    raw = readFileSync(file, 'utf8')
    try {
      current = JSON.parse(raw)
    } catch {
      throw new Error(`${file} is not JSON`)
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(`${file} must be an object`)
  }
  const projects = asObject(current.projects)
  const entry = asObject(projects[repo])
  entry.hasTrustDialogAccepted = true
  projects[repo] = entry
  current.projects = projects
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (next === raw) return
  writeFileSync(file, next)
}

export function install(root, pin, claudeSheet, codexSheet, marketplace) {
  const claudeDir = path.join(root, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(path.join(claudeDir, 'pstack-models.md'), claudeSheet)
  writeSettings(path.join(claudeDir, 'settings.json'), sessionSettings(claudeSheet), pin, marketplace)
  const claudeFile = path.join(root, 'CLAUDE.md')
  if (existsSync(claudeFile)) putPstack(claudeFile)
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
  trustClaude(homedir(), abs)
}
