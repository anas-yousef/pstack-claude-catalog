#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { appendSection, ensureSectionParagraph, replaceSection } from './lib/advisory.mjs'
import { clonePinned } from './lib/clone.mjs'
import { codexTables } from './lib/codex-config.mjs'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText } from './lib/remote.mjs'
import { agentsPaste, codexHome, copyProfile, sessionSettings } from './lib/sheet.mjs'
import { writeMerged } from './lib/toml.mjs'

const AGENTS_ADVISORY = 'This repo pins the pstack-claude catalog. Codex loads role models from the sheet in the Codex home. Run `node scripts/setup-pstack-codex.mjs` to install that sheet from the pin.'
const USAGE = 'usage: node scripts/setup-pstack-codex.mjs [--check|--outdated] [--write-user-config|--no-write-user-config] [--profile <name>] [--codex-profile <name>]'

function parseArgs(argv) {
  let check = false
  let writeUser = true
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check' || arg === '--outdated') {
      check = true
      continue
    }
    if (arg === '--write-user-config') {
      writeUser = true
      continue
    }
    if (arg === '--no-write-user-config') {
      writeUser = false
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
  return { check, writeUser }
}

async function main() {
  const { check, writeUser } = parseArgs(process.argv.slice(2))
  const root = process.cwd()
  const pin = readPin(root)
  const home = codexHome()
  const dest = path.join(home, 'pstack-models.md')
  if (check) {
    const sheet = await fetchCatalogText(pin.repo, pin.commit, path.posix.join('profiles', `${pin.codexProfile}.md`))
    const local = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
    const state = local === sheet ? 'current' : 'outdated'
    process.stdout.write(`${state} ${pin.commit}\n`)
    if (state !== 'current') process.exit(1)
    return
  }
  const checkout = clonePinned(pin)
  const sheet = copyProfile(checkout, pin.codexProfile, dest)
  const session = sessionSettings(sheet)
  if (writeUser) {
    const rootKeys = {}
    if (session.model) rootKeys.model = session.model
    if (session.effort) rootKeys.model_reasoning_effort = session.effort
    writeMerged(path.join(home, 'config.toml'), { root: rootKeys })
  }
  const marketplace = JSON.parse(readFileSync(path.join(checkout, '.claude-plugin', 'marketplace.json'), 'utf8'))
  if (!marketplace || typeof marketplace.name !== 'string' || marketplace.name === '') throw new Error('pinned marketplace.json needs a name')
  writeMerged(path.join(root, '.codex', 'config.toml'), { tables: codexTables(pin, marketplace.name) })
  const agentsFile = path.join(root, 'AGENTS.md')
  if (existsSync(path.join(root, 'CLAUDE.md'))) appendSection(agentsFile, '## pstack', AGENTS_ADVISORY)
  else ensureSectionParagraph(agentsFile, '## pstack', AGENTS_ADVISORY)
  replaceSection(path.join(home, 'AGENTS.md'), '## pstack models', agentsPaste(sheet))
  process.stdout.write('sheet ok\n')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
