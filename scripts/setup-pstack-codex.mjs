#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { codexTables, marketplaceFrom } from './lib/codex-config.mjs'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText } from './lib/remote.mjs'
import { agentsPaste, codexHome, putPstack, putSection, sessionSettings } from './lib/sheet.mjs'
import { writeConfig } from './lib/toml.mjs'

const root = process.cwd()
const pin = readPin(root)
const sheet = await fetchCatalogText(pin.repo, pin.commit, `profiles/${pin.codexProfile}.md`)
const home = codexHome()
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'pstack-models.md'), sheet)
putSection(path.join(home, 'AGENTS.md'), '## pstack models', agentsPaste(sheet))
const session = sessionSettings(sheet)
const marketplace = marketplaceFrom(await fetchCatalogText(pin.repo, pin.commit, '.claude-plugin/marketplace.json'))
writeConfig(path.join(root, '.codex', 'config.toml'), {
  root: { model: session.model, model_reasoning_effort: session.effort },
  tables: codexTables(pin, marketplace.name),
})
putPstack(path.join(root, 'AGENTS.md'))
