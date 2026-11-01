#!/usr/bin/env node
// curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>] [--ask-permissions]'
const LIBS = ['remote.mjs', 'pin.mjs', 'sheet.mjs', 'toml.mjs', 'install.mjs']
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const RAW = 'https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog'

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function argumentsFrom(argv) {
  let values
  try {
    values = parseArgs({
      args: argv,
      options: {
        profile: { type: 'string' },
        'codex-profile': { type: 'string' },
        commit: { type: 'string' },
        'ask-permissions': { type: 'boolean', default: false },
      },
      strict: true,
    }).values
  } catch {
    fail(USAGE)
  }
  const profile = values.profile || ''
  const codexProfile = values['codex-profile'] || ''
  const commit = (values.commit || '').toLowerCase()
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) fail('commit must be 40 hex characters')
  if ((profile && !SLUG.test(profile)) || (codexProfile && !SLUG.test(codexProfile))) fail('profile names must be plain slugs')
  return { profile, codexProfile, commit, askPermissions: values['ask-permissions'] }
}

function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const root = result.status === 0 ? result.stdout.trim() : ''
  return root || process.cwd()
}

function libUrl(name) {
  return process.env.PSTACK_CATALOG
    ? new URL(name, pathToFileURL(path.join(process.env.PSTACK_CATALOG, 'scripts/lib/'))).href
    : ''
}

async function load(commit) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pstack-'))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  try {
    let remote
    if (libUrl('remote.mjs')) remote = await import(libUrl('remote.mjs'))
    else {
      const ref = commit || 'main'
      const root = process.env.PSTACK_RAW || RAW
      const response = await fetch(`${root}/${ref}/scripts/lib/remote.mjs`, { headers: { 'User-Agent': 'pstack-claude-catalog' } })
      if (!response.ok) throw new Error(`cannot read scripts/lib/remote.mjs at ${ref}`)
      writeFileSync(path.join(dir, 'bootstrap.mjs'), await response.text())
      remote = await import(pathToFileURL(path.join(dir, 'bootstrap.mjs')).href)
    }
    const sha = commit || await remote.catalogMain(REPO)
    if (!remote.SHA.test(sha)) throw new Error(commit ? 'commit must be 40 hex characters' : `no main commit at ${REPO}`)
    const base = libUrl('remote.mjs')
      ? pathToFileURL(path.join(process.env.PSTACK_CATALOG, 'scripts/lib/'))
      : pathToFileURL(`${dir}/`)
    if (!libUrl('remote.mjs')) {
      for (const name of LIBS) {
        writeFileSync(path.join(dir, name), await remote.fetchCatalogText(REPO, sha, `scripts/lib/${name}`))
      }
    }
    return {
      sha,
      remote,
      install: await import(new URL('install.mjs', base).href),
      readPin: (await import(new URL('pin.mjs', base).href)).readPin,
      writePin: (await import(new URL('pin.mjs', base).href)).writePin,
      cleanup,
    }
  } catch (error) {
    cleanup()
    throw error
  }
}

async function sheet(remote, sha, name) {
  try {
    return await remote.fetchCatalogText(REPO, sha, `profiles/${name}.md`)
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex')
}

function assertOwned(root, rel, hashes, optional = false) {
  const parts = rel.split('/')
  for (let i = 1; i <= parts.length; i++) {
    const file = path.join(root, ...parts.slice(0, i))
    let stat
    try { stat = lstatSync(file) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (i === parts.length && optional && (!stat.isFile() || !hashes.includes(hash(readFileSync(file))))) return false
    if (stat.isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${file}`)
    if (i === parts.length && (!stat.isFile() || !hashes.includes(hash(readFileSync(file))))) {
      throw new Error(`refusing to overwrite foreign file: ${file}`)
    }
  }
  return true
}

function installedOwnership(root) {
  const file = path.join(root, '.claude/pstack-claude-owned.json')
  if (!existsSync(file)) return {}
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  if (manifest?.version !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)
    || Object.values(manifest.files).some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) {
    throw new Error(`invalid ownership manifest: ${file}`)
  }
  return manifest.files
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2))
  const root = repoRoot()
  const loaded = await load(args.commit)
  const { remote, install, readPin, writePin } = loaded
  try {
    const clients = install.assertHomes()
    const pinFile = path.join(root, '.claude', 'pstack-claude-pin.json')
    const pinned = !args.profile && !args.codexProfile && existsSync(pinFile) ? readPin(root) : null
    const profile = args.profile || pinned?.profile || process.env.PSTACK_PROFILE || 'balanced'
    if (!SLUG.test(profile)) fail('profile names must be plain slugs')
    const explicit = args.codexProfile || (!args.profile && pinned?.codexProfile) || ''
    let codexProfile = explicit || (profile.startsWith('codex-') ? profile : `codex-${profile}`)
    const { sha } = loaded
    const claudeSheet = await sheet(remote, sha, profile)
    if (!claudeSheet) throw new Error(`no profile ${profile} at ${sha}`)
    let codexSheet = await sheet(remote, sha, codexProfile)
    if (!codexSheet && !explicit) codexSheet = await sheet(remote, sha, codexProfile = 'codex-balanced')
    if (!codexSheet) throw new Error(`no profile ${codexProfile} at ${sha}`)
    const marketplace = install.marketplaceFrom(await remote.fetchCatalogText(REPO, sha, '.claude-plugin/marketplace.json'))
    const manifest = JSON.parse(await remote.fetchCatalogText(REPO, sha, 'scripts/lib/owned.json'))
    // Older catalogs listed only paths. Exact target bytes still establish ownership.
    const entries = Array.isArray(manifest) ? Object.fromEntries(manifest.map((rel) => [rel, {}])) : manifest.files
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('invalid catalog ownership manifest')
    const installed = installedOwnership(root)
    const owned = []
    for (const [rel, entry] of Object.entries(entries)) {
      if (!/^scripts\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.mjs$/.test(rel)) throw new Error(`invalid owned path: ${rel}`)
      const text = await remote.fetchCatalogText(REPO, sha, rel)
      const digest = hash(text)
      if (entry.sha256 && entry.sha256 !== digest) throw new Error(`catalog ownership hash mismatch: ${rel}`)
      const hashes = [digest, ...(entry.previous || []).map((version) => version.sha256), installed[rel]]
      if (assertOwned(root, rel, hashes, entry.optional)) owned.push([rel, text])
    }
    for (const [rel, text] of owned) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), text)
    }
    mkdirSync(path.join(root, '.claude'), { recursive: true })
    writeFileSync(path.join(root, '.claude/pstack-claude-owned.json'), `${JSON.stringify({ version: 1, files: Object.fromEntries(owned.map(([rel, text]) => [rel, hash(text)])) }, null, 2)}\n`)
    const pin = { repo: REPO, commit: sha, profile, codexProfile, plugins: marketplace.plugins }
    if (writePin) writePin(root, pin)
    else {
      mkdirSync(path.join(root, '.claude'), { recursive: true })
      writeFileSync(pinFile, `${JSON.stringify(pin, null, 2)}\n`)
    }
    await install.install(root, pin, claudeSheet, codexSheet, marketplace.name, args.askPermissions, clients)
  } finally {
    loaded.cleanup()
  }
}

main().catch((error) => fail(error.message || String(error)))
