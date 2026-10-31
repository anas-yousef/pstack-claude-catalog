#!/usr/bin/env node
// curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]'
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
  return { profile, codexProfile, commit }
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

async function main() {
  const args = argumentsFrom(process.argv.slice(2))
  const root = repoRoot()
  const loaded = await load(args.commit)
  const { remote, install, readPin } = loaded
  try {
    install.assertHomes()
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
    for (const rel of JSON.parse(await remote.fetchCatalogText(REPO, sha, 'scripts/lib/owned.json'))) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), await remote.fetchCatalogText(REPO, sha, rel))
    }
    const pin = { repo: REPO, commit: sha, profile, codexProfile, plugins: marketplace.plugins }
    mkdirSync(path.join(root, '.claude'), { recursive: true })
    writeFileSync(path.join(root, '.claude', 'pstack-claude-pin.json'), `${JSON.stringify(pin, null, 2)}\n`)
    install.install(root, pin, claudeSheet, codexSheet, marketplace.name)
  } finally {
    loaded.cleanup()
  }
}

main().catch((error) => fail(error.message || String(error)))
