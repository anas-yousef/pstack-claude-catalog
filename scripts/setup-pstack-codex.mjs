#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { clonePinned } from './lib/clone.mjs'
import { codexTables, readMarketplace } from './lib/codex-config.mjs'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText } from './lib/remote.mjs'
import { agentsPaste, codexHome, copyProfile, pstackBlock, putSection, sessionSettings } from './lib/sheet.mjs'
import { writeMerged } from './lib/toml.mjs'

const USAGE = 'usage: node scripts/setup-pstack-codex.mjs [--check|--outdated] [--write-user-config|--no-write-user-config]'

function parseArgs(argv) {
  let check = false
  let writeUser = true
  for (const arg of argv) {
    if (arg === '--check' || arg === '--outdated') check = true
    else if (arg === '--write-user-config') writeUser = true
    else if (arg === '--no-write-user-config') writeUser = false
    else throw new Error(USAGE)
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
    const sheet = await fetchCatalogText(pin.repo, pin.commit, `profiles/${pin.codexProfile}.md`)
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
  writeMerged(path.join(root, '.codex', 'config.toml'), { tables: codexTables(pin, readMarketplace(checkout)) })
  const agentsFile = path.join(root, 'AGENTS.md')
  putSection(agentsFile, '## pstack', pstackBlock(agentsFile))
  putSection(path.join(home, 'AGENTS.md'), '## pstack models', agentsPaste(sheet))
  process.stdout.write('sheet ok\n')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
