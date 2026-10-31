#!/usr/bin/env node
// curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]'
const LIBS = ['remote.mjs', 'pin.mjs', 'codex-config.mjs', 'sheet.mjs', 'toml.mjs', 'install.mjs']
const SLUG = /^[a-z0-9][a-z0-9-]*$/

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  let profile = ''
  let codexProfile = ''
  let commit = ''
  let profileSet = false
  let codexSet = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== '--profile' && arg !== '--codex-profile' && arg !== '--commit') fail(USAGE)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(USAGE)
    if (arg === '--profile') {
      profile = value
      profileSet = true
    }
    if (arg === '--codex-profile') {
      codexProfile = value
      codexSet = true
    }
    if (arg === '--commit') commit = value.toLowerCase()
    index += 1
  }
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) fail('commit must be 40 hex characters')
  if ((profile && !SLUG.test(profile)) || (codexProfile && !SLUG.test(codexProfile))) fail('profile names must be plain slugs')
  return { profile, codexProfile, commit, profileSet, codexSet }
}

function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const root = result.status === 0 ? result.stdout.trim() : ''
  return root || process.cwd()
}

function chooseProfiles(root, args) {
  if (!args.profileSet && !args.codexSet) {
    const pinned = readPinned(root)
    if (pinned) return pinned
  }
  const profile = args.profileSet ? args.profile : (process.env.PSTACK_PROFILE || 'balanced')
  if (!SLUG.test(profile)) fail('profile names must be plain slugs')
  return { profile, codexProfile: args.codexProfile, locked: args.codexSet }
}

function readPinned(root) {
  const file = path.join(root, '.claude', 'pstack-claude-pin.json')
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`cannot read ${file}`)
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !SLUG.test(parsed.profile) || !SLUG.test(parsed.codexProfile)) throw new Error('shape')
    return { profile: parsed.profile, codexProfile: parsed.codexProfile, locked: true }
  } catch {
    throw new Error(`cannot read ${file}`)
  }
}

async function tipSha() {
  const response = await fetch(`${REPO}.git/info/refs?service=git-upload-pack`, {
    headers: { 'User-Agent': 'pstack-claude-catalog' },
  })
  if (!response.ok) throw new Error(`cannot read main at ${REPO}`)
  const text = await response.text()
  const marker = ' refs/heads/main'
  const at = text.indexOf(marker)
  return at >= 40 ? text.slice(at - 40, at) : ''
}

function catalogUrl(name) {
  return new URL(name, pathToFileURL(path.join(process.env.PSTACK_CATALOG, 'scripts/lib/'))).href
}

async function pull(sha, rel) {
  const base = process.env.PSTACK_RAW || 'https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog'
  const response = await fetch(`${base}/${sha}/${rel}`, { headers: { 'User-Agent': 'pstack-claude-catalog' } })
  if (!response.ok) {
    const error = new Error(`cannot read ${rel} at ${sha}`)
    error.status = response.status
    throw error
  }
  return response.text()
}

async function load(requested) {
  if (process.env.PSTACK_CATALOG) {
    const remote = await import(catalogUrl('remote.mjs'))
    if (requested && !remote.SHA.test(requested)) throw new Error('commit must be 40 hex characters')
    const sha = requested || await remote.catalogMain(REPO)
    return {
      sha,
      remote,
      codex: await import(catalogUrl('codex-config.mjs')),
      install: await import(catalogUrl('install.mjs')),
      cleanup() {},
    }
  }
  const sha = requested || await tipSha()
  const dir = mkdtempSync(path.join(tmpdir(), 'pstack-'))
  try {
    writeFileSync(path.join(dir, 'remote.mjs'), await pull(sha, 'scripts/lib/remote.mjs'))
    const base = pathToFileURL(`${dir}/`)
    const remote = await import(new URL('remote.mjs', base).href)
    if (!remote.SHA.test(sha)) throw new Error(requested ? 'commit must be 40 hex characters' : `no main commit at ${REPO}`)
    for (const name of LIBS) {
      if (name === 'remote.mjs') continue
      writeFileSync(path.join(dir, name), await remote.fetchCatalogText(REPO, sha, `scripts/lib/${name}`))
    }
    return {
      sha,
      remote,
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

async function oneSheet(remote, sha, name) {
  try {
    return await remote.fetchCatalogText(REPO, sha, `profiles/${name}.md`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = repoRoot()
  const profiles = chooseProfiles(root, args)
  const loaded = await load(args.commit)
  const { remote, codex, install } = loaded
  try {
    install.assertHomes()
    const { sha } = loaded
    const claudeSheet = await oneSheet(remote, sha, profiles.profile)
    if (!claudeSheet) throw new Error(`no profile ${profiles.profile} at ${sha}`)
    let codexProfile = profiles.codexProfile
    let codexSheet = null
    if (profiles.locked) {
      codexSheet = await oneSheet(remote, sha, codexProfile)
    } else {
      codexProfile = profiles.profile.startsWith('codex-') ? profiles.profile : `codex-${profiles.profile}`
      codexSheet = await oneSheet(remote, sha, codexProfile)
      if (!codexSheet) {
        codexProfile = 'codex-balanced'
        codexSheet = await oneSheet(remote, sha, codexProfile)
      }
    }
    if (!codexSheet) throw new Error(`no profile ${codexProfile} at ${sha}`)
    const marketplace = codex.marketplaceFrom(await remote.fetchCatalogText(REPO, sha, '.claude-plugin/marketplace.json'))
    const owned = JSON.parse(await remote.fetchCatalogText(REPO, sha, 'scripts/lib/owned.json'))
    for (const rel of owned) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), await remote.fetchCatalogText(REPO, sha, rel))
    }
    const pin = { repo: REPO, commit: sha, profile: profiles.profile, codexProfile, plugins: marketplace.plugins }
    mkdirSync(path.join(root, '.claude'), { recursive: true })
    writeFileSync(path.join(root, '.claude', 'pstack-claude-pin.json'), `${JSON.stringify(pin, null, 2)}\n`)
    install.install(root, pin, claudeSheet, codexSheet, marketplace.name)
  } finally {
    loaded.cleanup()
  }
}

main().catch((error) => fail(error.message || String(error)))
