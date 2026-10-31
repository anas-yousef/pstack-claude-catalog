#!/usr/bin/env node
// curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]'
const LIBS = ['remote.mjs', 'pin.mjs', 'codex-config.mjs', 'sheet.mjs', 'toml.mjs', 'install.mjs']

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function isSha(value) {
  if (value.length !== 40) return false
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false
  }
  return true
}

function parseArgs(argv) {
  let profile = process.env.PSTACK_PROFILE || 'balanced'
  let codexProfile = ''
  let commit = ''
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--profile' && arg !== '--codex-profile' && arg !== '--commit') fail(USAGE)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(USAGE)
    if (arg === '--profile') profile = value
    if (arg === '--codex-profile') codexProfile = value
    if (arg === '--commit') commit = value.toLowerCase()
    index += 1
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile) || (codexProfile && !/^[a-z0-9][a-z0-9-]*$/.test(codexProfile))) {
    fail('profile names must be plain slugs')
  }
  if (commit && !isSha(commit)) fail('commit must be 40 hex characters')
  return { profile, codexProfile, commit }
}

function rawBase() {
  return process.env.PSTACK_RAW || 'https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog'
}

async function textAt(ref, rel) {
  const response = await fetch(`${rawBase()}/${ref}/${rel}`, { headers: { 'User-Agent': 'pstack-claude-catalog' } })
  if (!response.ok) {
    const error = new Error(`cannot read ${rel} at ${ref}`)
    error.status = response.status
    throw error
  }
  return response.text()
}

async function modules(ref) {
  if (process.env.PSTACK_CATALOG) {
    const base = pathToFileURL(path.join(process.env.PSTACK_CATALOG, 'scripts/lib/'))
    return {
      remote: await import(new URL('remote.mjs', base).href),
      codex: await import(new URL('codex-config.mjs', base).href),
      install: await import(new URL('install.mjs', base).href),
      cleanup() {},
    }
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'pstack-'))
  try {
    for (const name of LIBS) writeFileSync(path.join(dir, name), await textAt(ref, `scripts/lib/${name}`))
    const base = pathToFileURL(`${dir}/`)
    return {
      remote: await import(new URL('remote.mjs', base).href),
      codex: await import(new URL('codex-config.mjs', base).href),
      install: await import(new URL('install.mjs', base).href),
      cleanup() {
        rmSync(dir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

async function oneSheet(remote, commit, name) {
  try {
    return await remote.fetchCatalogText(REPO, commit, `profiles/${name}.md`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function main() {
  const { profile, codexProfile: explicit, commit: requested } = parseArgs(process.argv.slice(2))
  const loaded = await modules(requested || 'main')
  const { remote, codex, install } = loaded
  try {
    const commit = requested || await remote.catalogMain(REPO)
    const claudeSheet = await oneSheet(remote, commit, profile)
    if (!claudeSheet) throw new Error(`no profile ${profile} at ${commit}`)
    const derived = explicit || (profile.startsWith('codex-') ? profile : `codex-${profile}`)
    let codexProfile = derived
    let codexSheet = await oneSheet(remote, commit, derived)
    if (!codexSheet && !explicit) {
      codexProfile = 'codex-balanced'
      codexSheet = await oneSheet(remote, commit, codexProfile)
    }
    if (!codexSheet) throw new Error(`no profile ${codexProfile} at ${commit}`)
    const marketplace = codex.marketplaceFrom(await remote.fetchCatalogText(REPO, commit, '.claude-plugin/marketplace.json'))
    const root = process.cwd()
    const source = process.env.PSTACK_CATALOG
    const owned = JSON.parse(source
      ? readFileSync(path.join(source, 'scripts/lib/owned.json'), 'utf8')
      : await textAt(commit, 'scripts/lib/owned.json'))
    for (const rel of owned) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), source ? readFileSync(path.join(source, rel)) : await textAt(commit, rel))
    }
    const pin = { repo: REPO, commit, profile, codexProfile, plugins: marketplace.plugins }
    mkdirSync(path.join(root, '.claude'), { recursive: true })
    writeFileSync(path.join(root, '.claude', 'pstack-claude-pin.json'), `${JSON.stringify(pin, null, 2)}\n`)
    install.install(root, pin, claudeSheet, codexSheet, marketplace.name)
  } finally {
    loaded.cleanup()
  }
}

main().catch((error) => fail(error.message || String(error)))
