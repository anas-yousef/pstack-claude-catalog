#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { marketplaceFrom } from './lib/codex-config.mjs'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText, githubSlug } from './lib/remote.mjs'
import { putPstack, sessionSettings } from './lib/sheet.mjs'

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const ALLOW = ['Bash(node scripts/check-pstack.mjs)', 'Bash(node scripts/check-pstack.mjs *)']

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

const root = process.cwd()
const pin = readPin(root)
const sheet = await fetchCatalogText(pin.repo, pin.commit, `profiles/${pin.profile}.md`)
mkdirSync(path.join(root, '.claude'), { recursive: true })
writeFileSync(path.join(root, '.claude', 'pstack-models.md'), sheet)
const marketplace = marketplaceFrom(await fetchCatalogText(pin.repo, pin.commit, '.claude-plugin/marketplace.json'))
writeSettings(path.join(root, '.claude', 'settings.json'), sessionSettings(sheet), pin, marketplace.name)
const claudeFile = path.join(root, 'CLAUDE.md')
putPstack(existsSync(claudeFile) ? claudeFile : path.join(root, 'AGENTS.md'))
