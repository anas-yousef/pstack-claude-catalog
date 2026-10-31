#!/usr/bin/env node
// Adopt this public catalog in the current repository.
//
//   curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -
//   node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]
//
// Writes .claude/pstack-claude-pin.json, copies scripts/setup-pstack-claude.mjs
// and scripts/setup-pstack-codex.mjs with their helpers, writes
// .codex/config.toml with the pinned plugins enabled, then runs both setup
// scripts in this repository. Each script prints `sheet ok` when its sheet
// passes. PSTACK_PROFILE selects the Claude profile when --profile is absent.
// Setup writes the chosen sheet's main session row, not a role row.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = 'https://github.com/anas-yousef/pstack-claude-catalog'
const DEFAULT_PROFILE = 'balanced'
const DEFAULT_CODEX_PROFILE = 'codex-balanced'
const SETUPS = [
  'scripts/setup-pstack-claude.mjs',
  'scripts/setup-pstack-codex.mjs',
]
const SHA = /^[0-9a-f]{40}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const USAGE = 'usage: node tools/init.mjs [--profile <name>] [--codex-profile <name>] [--commit <sha>]'
const FILES = [
  'scripts/setup-pstack-claude.mjs',
  'scripts/setup-pstack-codex.mjs',
  'scripts/lib/advisory.mjs',
  'scripts/lib/clone.mjs',
  'scripts/lib/codex-config.mjs',
  'scripts/lib/pin.mjs',
  'scripts/lib/sheet.mjs',
  'scripts/lib/toml.mjs',
]

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function gitEnv(blank) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key === 'GIT_CONFIG_COUNT'
      || key.startsWith('GIT_CONFIG_KEY_')
      || key.startsWith('GIT_CONFIG_VALUE_')
      || key === 'GH_TOKEN'
      || key === 'GITHUB_TOKEN'
      || key === 'GH_ENTERPRISE_TOKEN'
    ) {
      delete env[key]
    }
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_CONFIG_GLOBAL = blank
  env.GIT_CONFIG_SYSTEM = blank
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_COUNT = '1'
  env.GIT_CONFIG_KEY_0 = 'credential.helper'
  env.GIT_CONFIG_VALUE_0 = ''
  return env
}

function catalogRoot() {
  if (!import.meta.url.startsWith('file:')) return null
  const file = fileURLToPath(import.meta.url)
  if (path.basename(file) !== 'init.mjs') return null
  return path.resolve(path.dirname(file), '..')
}

function parseArgs(argv) {
  const fromEnv = process.env.PSTACK_PROFILE
  let profile = fromEnv ? fromEnv : DEFAULT_PROFILE
  let codexProfile = DEFAULT_CODEX_PROFILE
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
  if (!SLUG.test(profile) || !SLUG.test(codexProfile)) fail('profile names must be plain slugs')
  if (commit && !SHA.test(commit)) fail('commit must be 40 hex characters')
  return { profile, codexProfile, commit }
}

function runSetup(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []
    child.stdout.on('data', (chunk) => {
      out.push(chunk)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (status) => {
      const stdout = Buffer.concat(out).toString('utf8')
      if (status !== 0) reject(new Error(`${path.basename(script)} exited ${status}`))
      else if (!stdout.includes('sheet ok')) reject(new Error(`${path.basename(script)} sheet check failed`))
      else resolve()
    })
  })
}

function mainSha() {
  const blank = path.join(homedir(), '.cache', 'pstack-claude-catalog', 'gitconfig')
  mkdirSync(path.dirname(blank), { recursive: true })
  writeFileSync(blank, '')
  const url = `${REPO}.git`
  const result = spawnSync('git', ['ls-remote', url, 'refs/heads/main'], {
    encoding: 'utf8',
    env: gitEnv(blank),
  })
  if (result.status !== 0) fail(`cannot read main: ${(result.stderr || result.stdout || '').trim()}`)
  const sha = (result.stdout || '').split('\n').map((line) => line.split('\t')[0]).find((item) => SHA.test(item))
  if (!sha) fail(`no main commit at ${REPO}`)
  return sha
}

async function profileAt(commit, name) {
  const url = `https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/${commit}/profiles/${name}.md`
  const response = await fetch(url, { method: 'GET' })
  if (response.status === 404) throw new Error(`no profile ${name} at ${commit}`)
  if (!response.ok) throw new Error(`cannot read profile ${name} at ${commit}`)
  await response.arrayBuffer()
}

async function textAt(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`cannot fetch ${url}`)
  return response.text()
}

async function marketplaceAt(commit) {
  const body = await textAt(`https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/${commit}/.claude-plugin/marketplace.json`)
  let json
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error(`marketplace.json at ${commit} is not JSON`)
  }
  if (!json || typeof json.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(json.name)) {
    throw new Error('marketplace.json needs a plain name')
  }
  if (!Array.isArray(json.plugins) || json.plugins.length === 0) throw new Error('marketplace.json needs plugins')
  const plugins = json.plugins.map((plugin) => {
    if (!plugin || typeof plugin.name !== 'string' || !SLUG.test(plugin.name)) throw new Error('marketplace plugin name is not a plain slug')
    return plugin.name
  })
  return { name: json.name, plugins }
}

async function fileBytes(rel, commit, sourceRoot) {
  if (sourceRoot) return readFileSync(path.join(sourceRoot, rel))
  const body = await textAt(`https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/${commit}/${rel}`)
  return body
}

async function main() {
  const { profile, codexProfile, commit: requested } = parseArgs(process.argv.slice(2))
  const commit = requested || mainSha()
  await profileAt(commit, profile)
  await profileAt(commit, codexProfile)
  const sourceRoot = catalogRoot()
  const root = process.cwd()
  for (const rel of FILES) {
    const target = path.join(root, rel)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, await fileBytes(rel, commit, sourceRoot))
  }
  const marketplace = await marketplaceAt(commit)
  const pin = {
    repo: REPO,
    commit,
    profile,
    codexProfile,
    plugins: marketplace.plugins,
  }
  const pinPath = path.join(root, '.claude', 'pstack-claude-pin.json')
  mkdirSync(path.dirname(pinPath), { recursive: true })
  writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`)
  const { codexTables } = await import(pathToFileURL(path.join(root, 'scripts/lib/codex-config.mjs')).href)
  const { writeMerged } = await import(pathToFileURL(path.join(root, 'scripts/lib/toml.mjs')).href)
  writeMerged(path.join(root, '.codex', 'config.toml'), { tables: codexTables(pin, marketplace.name) })
  const setupArgs = ['--profile', profile, '--codex-profile', codexProfile]
  for (const rel of SETUPS) {
    await runSetup(path.join(root, rel), setupArgs)
  }
}

main().catch((error) => fail(error.message || String(error)))
