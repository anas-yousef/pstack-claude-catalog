#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { appendSection, ensureSectionParagraph } from './lib/advisory.mjs'
import { clonePinned } from './lib/clone.mjs'
import { readPin } from './lib/pin.mjs'
import { copyProfile } from './lib/sheet.mjs'

const CLAUDE_ADVISORY = [
  '@.claude/pstack-models.md',
  '',
  'This repo pins the pstack-claude catalog. The model sheet is `.claude/pstack-models.md`. Run `node scripts/setup-pstack-claude.mjs` to install that sheet from the pin.',
].join('\n')

try {
  const root = process.cwd()
  const pin = readPin(root)
  const checkout = clonePinned(pin)
  copyProfile(checkout, pin.profile, path.join(root, '.claude', 'pstack-models.md'))
  const claudeFile = path.join(root, 'CLAUDE.md')
  if (existsSync(claudeFile)) appendSection(claudeFile, '## pstack', CLAUDE_ADVISORY)
  else ensureSectionParagraph(path.join(root, 'AGENTS.md'), '## pstack', CLAUDE_ADVISORY, true)
  process.stdout.write('sheet ok\n')
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
