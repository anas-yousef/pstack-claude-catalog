#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { appendSection, CHECK_LINE, ensureSectionParagraph, omitPresentLine } from './lib/advisory.mjs'
import { clonePinned } from './lib/clone.mjs'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText, githubSlug } from './lib/remote.mjs'
import { copyProfile, sessionSettings } from './lib/sheet.mjs'

const MODEL_INCLUDE = '@.claude/pstack-models.md'
const CLAUDE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const CHECK_ALLOW = [
  'Bash(node scripts/check-pstack.mjs)',
  'Bash(node scripts/check-pstack.mjs *)',
  'Bash(node scripts/setup-pstack-claude.mjs --check)',
  'Bash(node scripts/setup-pstack-claude.mjs --outdated)',
  'Bash(node scripts/setup-pstack-codex.mjs --check)',
  'Bash(node scripts/setup-pstack-codex.mjs --outdated)',
]
const CLAUDE_ADVISORY = [
  MODEL_INCLUDE,
  '',
  'This repo pins the pstack-claude catalog. The model sheet is `.claude/pstack-models.md`. Run `node scripts/setup-pstack-claude.mjs` to install that sheet from the pin.',
  '',
  CHECK_LINE,
].join('\n')
const USAGE = 'usage: node scripts/setup-pstack-claude.mjs [--check|--outdated] [--profile <name>] [--codex-profile <name>]'

function parseArgs(argv) {
  let check = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check' || arg === '--outdated') {
      check = true
      continue
    }
    if (arg === '--profile' || arg === '--codex-profile') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(USAGE)
      index += 1
      continue
    }
    throw new Error(USAGE)
  }
  return check
}

function objectAt(current, key, label) {
  const value = current[key]
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function writeSettings(file, session, pin, marketplace) {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let current = {}
  if (raw !== '') {
    try {
      current = JSON.parse(raw)
    } catch {
      throw new Error(`cannot read ${file}`)
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(`${file} must be an object`)
  }
  current.model = session.model
  if (CLAUDE_EFFORT.has(session.effort)) current.effortLevel = session.effort
  const permissions = objectAt(current, 'permissions', 'permissions')
  const allow = Array.isArray(permissions.allow) ? permissions.allow.slice() : []
  if (permissions.allow !== undefined && !Array.isArray(permissions.allow)) throw new Error('permissions.allow must be an array')
  for (const rule of CHECK_ALLOW) {
    if (!allow.includes(rule)) allow.push(rule)
  }
  permissions.allow = allow
  current.permissions = permissions
  const markets = objectAt(current, 'extraKnownMarketplaces', 'extraKnownMarketplaces')
  const existing = markets[marketplace]
  const prior = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const source = prior.source && typeof prior.source === 'object' && !Array.isArray(prior.source) ? prior.source : {}
  const repo = githubSlug(pin.repo)
  const nextSource = {
    ...source,
    source: 'github',
    repo,
  }
  if (/^[0-9a-f]{40}$/.test(nextSource.ref)) delete nextSource.ref
  markets[marketplace] = {
    ...prior,
    source: nextSource,
  }
  current.extraKnownMarketplaces = markets
  const enabled = objectAt(current, 'enabledPlugins', 'enabledPlugins')
  for (const plugin of pin.plugins) enabled[`${plugin}@${marketplace}`] = true
  current.enabledPlugins = enabled
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (next === raw) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}

function marketplaceName(checkout) {
  const marketplace = JSON.parse(readFileSync(path.join(checkout, '.claude-plugin', 'marketplace.json'), 'utf8'))
  if (!marketplace || typeof marketplace.name !== 'string' || marketplace.name === '') throw new Error('pinned marketplace.json needs a name')
  return marketplace.name
}

async function main() {
  const check = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const pin = readPin(root)
  const dest = path.join(root, '.claude', 'pstack-models.md')
  if (check) {
    const sheet = await fetchCatalogText(pin.repo, pin.commit, path.posix.join('profiles', `${pin.profile}.md`))
    const local = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
    const state = local === sheet ? 'current' : 'outdated'
    process.stdout.write(`${state} ${pin.commit}\n`)
    if (state !== 'current') process.exit(1)
    return
  }
  const checkout = clonePinned(pin)
  const sheet = copyProfile(checkout, pin.profile, dest)
  writeSettings(path.join(root, '.claude', 'settings.json'), sessionSettings(sheet), pin, marketplaceName(checkout))
  const claudeFile = path.join(root, 'CLAUDE.md')
  const target = existsSync(claudeFile) ? claudeFile : path.join(root, 'AGENTS.md')
  const body = omitPresentLine(target, CLAUDE_ADVISORY, MODEL_INCLUDE)
  if (target === claudeFile) appendSection(target, '## pstack', body)
  else ensureSectionParagraph(target, '## pstack', body, true)
  process.stdout.write('sheet ok\n')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
