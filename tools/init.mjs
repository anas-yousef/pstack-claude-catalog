#!/usr/bin/env node
// curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const SHA = /^[0-9a-f]{40}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]'
const SETUPS = ['scripts/setup-pstack-claude.mjs', 'scripts/setup-pstack-codex.mjs']

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function catalogRoot() {
  if (process.env.PSTACK_CATALOG) return process.env.PSTACK_CATALOG
  if (!import.meta.url.startsWith('file:')) return null
  const file = fileURLToPath(import.meta.url)
  if (path.basename(file) !== 'init.mjs') return null
  return path.resolve(path.dirname(file), '..')
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
  if (!SLUG.test(profile) || (codexProfile && !SLUG.test(codexProfile))) fail('profile names must be plain slugs')
  if (commit && !SHA.test(commit)) fail('commit must be 40 hex characters')
  return { profile, codexProfile, commit }
}

function codexName(profile, explicit) {
  if (explicit) return explicit
  return profile.startsWith('codex-') ? profile : `codex-${profile}`
}

function runSetup(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (status) => (status === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited ${status}`))))
  })
}

async function load(name) {
  const root = catalogRoot()
  if (root) return import(pathToFileURL(path.join(root, 'scripts/lib', name)).href)
  const dir = path.join(tmpdir(), 'pstack-init-libs')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  if (!existsSync(file)) {
    const response = await fetch(`https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/scripts/lib/${name}`)
    if (!response.ok) fail(`cannot read scripts/lib/${name}`)
    writeFileSync(file, await response.text())
  }
  return import(pathToFileURL(file).href)
}

async function main() {
  const { profile, codexProfile: explicit, commit: requested } = parseArgs(process.argv.slice(2))
  const remote = await load('remote.mjs')
  const { marketplaceFrom } = await load('codex-config.mjs')
  const commit = requested || await remote.catalogMain(REPO)
  let codexProfile = codexName(profile, explicit)
  try {
    await remote.fetchCatalogText(REPO, commit, `profiles/${profile}.md`)
  } catch (error) {
    if (error.status === 404) throw new Error(`no profile ${profile} at ${commit}`)
    throw error
  }
  try {
    await remote.fetchCatalogText(REPO, commit, `profiles/${codexProfile}.md`)
  } catch (error) {
    if (error.status === 404 && !explicit && codexProfile !== 'codex-balanced') {
      codexProfile = 'codex-balanced'
      await remote.fetchCatalogText(REPO, commit, 'profiles/codex-balanced.md')
    } else if (error.status === 404) throw new Error(`no profile ${codexProfile} at ${commit}`)
    else throw error
  }
  const source = catalogRoot()
  const root = process.cwd()
  const owned = JSON.parse(source
    ? readFileSync(path.join(source, 'scripts/lib/owned.json'), 'utf8')
    : await remote.fetchCatalogText(REPO, commit, 'scripts/lib/owned.json'))
  for (const rel of owned) {
    const target = path.join(root, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source ? readFileSync(path.join(source, rel)) : await remote.fetchCatalogText(REPO, commit, rel))
  }
  const marketplace = marketplaceFrom(await remote.fetchCatalogText(REPO, commit, '.claude-plugin/marketplace.json'))
  const pinPath = path.join(root, '.claude', 'pstack-claude-pin.json')
  mkdirSync(path.dirname(pinPath), { recursive: true })
  writeFileSync(pinPath, `${JSON.stringify({ repo: REPO, commit, profile, codexProfile, plugins: marketplace.plugins }, null, 2)}\n`)
  for (const rel of SETUPS) await runSetup(path.join(root, rel))
}

main().catch((error) => fail(error.message || String(error)))
