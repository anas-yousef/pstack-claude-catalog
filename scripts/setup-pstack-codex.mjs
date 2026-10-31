#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { appendSection, replaceSection } from './lib/advisory.mjs'
import { clonePinned } from './lib/clone.mjs'
import { codexTables } from './lib/codex-config.mjs'
import { readPin } from './lib/pin.mjs'
import { agentsPaste, codexHome, copyProfile, sessionSettings } from './lib/sheet.mjs'
import { writeMerged } from './lib/toml.mjs'

const AGENTS_ADVISORY = 'This repo pins the pstack-claude catalog. Codex loads role models from the sheet in the Codex home. Run `node scripts/setup-pstack-codex.mjs` to install that sheet from the pin.'

try {
  const root = process.cwd()
  const pin = readPin(root)
  const checkout = clonePinned(pin)
  const home = codexHome()
  const sheet = copyProfile(checkout, pin.codexProfile, path.join(home, 'pstack-models.md'))
  const session = sessionSettings(sheet)
  const rootKeys = {}
  if (session.model) rootKeys.model = session.model
  if (session.effort) rootKeys.model_reasoning_effort = session.effort
  writeMerged(path.join(home, 'config.toml'), { root: rootKeys })
  const marketplace = JSON.parse(readFileSync(path.join(checkout, '.claude-plugin', 'marketplace.json'), 'utf8'))
  if (!marketplace || typeof marketplace.name !== 'string' || marketplace.name === '') throw new Error('pinned marketplace.json needs a name')
  writeMerged(path.join(root, '.codex', 'config.toml'), { tables: codexTables(pin, marketplace.name) })
  appendSection(path.join(root, 'AGENTS.md'), '## pstack', AGENTS_ADVISORY)
  replaceSection(path.join(home, 'AGENTS.md'), '## pstack models', agentsPaste(sheet))
  process.stdout.write('sheet ok\n')
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
