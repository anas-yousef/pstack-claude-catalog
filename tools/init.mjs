#!/usr/bin/env node
// Adopt this catalog:
//   curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -
// Copies scripts/lib/owned.json, writes the project .codex/config.toml
// marketplace ref, and runs both setup scripts.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const DEFAULT_PROFILE = 'balanced'
const DEFAULT_CODEX_PROFILE = 'codex-balanced'
const SETUPS = ['scripts/setup-pstack-claude.mjs', 'scripts/setup-pstack-codex.mjs']
const SHA = /^[0-9a-f]{40}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]'
const LEGACY_FILES = [
  'scripts/setup-pstack-claude.mjs',
  'scripts/setup-pstack-codex.mjs',
  'scripts/lib/advisory.mjs',
  'scripts/lib/clone.mjs',
  'scripts/lib/codex-config.mjs',
  'scripts/lib/pin.mjs',
  'scripts/lib/sheet.mjs',
  'scripts/lib/toml.mjs',
]
const CODEX_TWIN = {
  balanced: 'codex-balanced',
  lean: 'codex-lean',
  'design-heavy': 'codex-design-heavy',
  'design-heavy-extra': 'codex-design-heavy-extra',
}
const RAW = `https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog`

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
  const fromEnv = process.env.PSTACK_PROFILE
  let profile = fromEnv || DEFAULT_PROFILE
  let codexProfile = ''
  let commit = ''
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile' || arg === '--codex-profile' || arg === '--commit') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(USAGE)
      if (arg === '--profile') profile = value
      if (arg === '--codex-profile') codexProfile = value
      if (arg === '--commit') commit = value.toLowerCase()
      index += 1
      continue
    }
    fail(USAGE)
  }
  if (!codexProfile) codexProfile = CODEX_TWIN[profile] || DEFAULT_CODEX_PROFILE
  if (!SLUG.test(profile) || !SLUG.test(codexProfile)) fail('profile names must be plain slugs')
  if (commit && !SHA.test(commit)) fail('commit must be 40 hex characters')
  return { profile, codexProfile, commit }
}

function runSetup(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    child.stdout.on('data', (chunk) => {
      out.push(chunk)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.on('error', reject)
    child.on('close', (status) => {
      const stdout = Buffer.concat(out).toString('utf8')
      if (status !== 0) reject(new Error(`${path.basename(script)} exited ${status}`))
      else if (!stdout.includes('sheet ok')) reject(new Error(`${path.basename(script)} sheet check failed`))
      else resolve()
    })
  })
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    const error = new Error(`cannot fetch ${url}`)
    error.status = response.status
    throw error
  }
  return response.text()
}

async function mainSha() {
  const match = /([0-9a-f]{40}) refs\/heads\/main/.exec(await fetchText(`${REPO}.git/info/refs?service=git-upload-pack`))
  if (!match) fail(`no main commit at ${REPO}`)
  return match[1]
}

async function ownedFiles(commit, sourceRoot) {
  const rel = 'scripts/lib/owned.json'
  try {
    const body = sourceRoot ? readFileSync(path.join(sourceRoot, rel), 'utf8') : await fetchText(`${RAW}/${commit}/${rel}`)
    const list = JSON.parse(body)
    if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== 'string' || item.includes('..'))) {
      throw new Error('owned.json needs catalog paths')
    }
    return list
  } catch (error) {
    if (!sourceRoot && error.status === 404) return LEGACY_FILES
    throw error
  }
}

async function main() {
  const { profile, codexProfile, commit: requested } = parseArgs(process.argv.slice(2))
  const commit = requested || await mainSha()
  for (const name of [profile, codexProfile]) {
    try {
      await fetchText(`${RAW}/${commit}/profiles/${name}.md`)
    } catch (error) {
      if (error.status === 404) throw new Error(`no profile ${name} at ${commit}`)
      throw new Error(`cannot read profile ${name} at ${commit}`)
    }
  }
  const sourceRoot = catalogRoot()
  const root = process.cwd()
  const files = await ownedFiles(commit, sourceRoot)
  for (const rel of files) {
    const target = path.join(root, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    const bytes = sourceRoot ? readFileSync(path.join(sourceRoot, rel)) : await fetchText(`${RAW}/${commit}/${rel}`)
    writeFileSync(target, bytes)
  }
  const retired = path.join(root, 'scripts/lib/advisory.mjs')
  if (!files.includes('scripts/lib/advisory.mjs') && existsSync(retired)) unlinkSync(retired)
  let marketplace
  try {
    marketplace = JSON.parse(await fetchText(`${RAW}/${commit}/.claude-plugin/marketplace.json`))
  } catch {
    throw new Error(`marketplace.json at ${commit} is not JSON`)
  }
  if (!marketplace || typeof marketplace.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(marketplace.name)) {
    throw new Error('marketplace.json needs a plain name')
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) throw new Error('marketplace.json needs plugins')
  const plugins = marketplace.plugins.map((plugin) => {
    if (!plugin || typeof plugin.name !== 'string' || !SLUG.test(plugin.name)) throw new Error('marketplace plugin name is not a plain slug')
    return plugin.name
  })
  const pinPath = path.join(root, '.claude', 'pstack-claude-pin.json')
  mkdirSync(path.dirname(pinPath), { recursive: true })
  writeFileSync(pinPath, `${JSON.stringify({ repo: REPO, commit, profile, codexProfile, plugins }, null, 2)}\n`)
  const { codexTables } = await import(pathToFileURL(path.join(root, 'scripts/lib/codex-config.mjs')).href)
  const { writeMerged } = await import(pathToFileURL(path.join(root, 'scripts/lib/toml.mjs')).href)
  writeMerged(path.join(root, '.codex', 'config.toml'), { tables: codexTables({ repo: REPO, commit, plugins }, marketplace.name) })
  for (const rel of SETUPS) await runSetup(path.join(root, rel))
}

main().catch((error) => fail(error.message || String(error)))
