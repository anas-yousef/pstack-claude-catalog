#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { clonePinned } from './lib/clone.mjs'
import { readMarketplace } from './lib/codex-config.mjs'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText, githubSlug } from './lib/remote.mjs'
import { copyProfile, pstackBlock, putSection, sessionSettings } from './lib/sheet.mjs'

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const ALLOW = ['Bash(node scripts/check-pstack.mjs)', 'Bash(node scripts/check-pstack.mjs *)']
const USAGE = 'usage: node scripts/setup-pstack-claude.mjs [--check|--outdated]'

function wantsCheck(argv) {
  if (argv.length === 0) return false
  if (argv.length === 1 && (argv[0] === '--check' || argv[0] === '--outdated')) return true
  throw new Error(USAGE)
}

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
  const permissions = asObject(current.permissions)
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((rule) => typeof rule === 'string') : []
  for (const rule of ALLOW) if (!allow.includes(rule)) allow.push(rule)
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

async function main() {
  const check = wantsCheck(process.argv.slice(2))
  const root = process.cwd()
  const pin = readPin(root)
  const dest = path.join(root, '.claude', 'pstack-models.md')
  if (check) {
    const sheet = await fetchCatalogText(pin.repo, pin.commit, `profiles/${pin.profile}.md`)
    const local = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
    const state = local === sheet ? 'current' : 'outdated'
    process.stdout.write(`${state} ${pin.commit}\n`)
    if (state !== 'current') process.exit(1)
    return
  }
  const checkout = clonePinned(pin)
  const sheet = copyProfile(checkout, pin.profile, dest)
  writeSettings(path.join(root, '.claude', 'settings.json'), sessionSettings(sheet), pin, readMarketplace(checkout))
  const claudeFile = path.join(root, 'CLAUDE.md')
  const target = existsSync(claudeFile) ? claudeFile : path.join(root, 'AGENTS.md')
  putSection(target, '## pstack', pstackBlock(target))
  process.stdout.write('sheet ok\n')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
