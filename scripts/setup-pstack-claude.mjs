#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import { appendSection, ensureSectionParagraph, omitPresentLine } from './lib/advisory.mjs'
import { clonePinned } from './lib/clone.mjs'
import { readPin } from './lib/pin.mjs'
import { copyProfile } from './lib/sheet.mjs'

const MODEL_INCLUDE = '@.claude/pstack-models.md'
const CLAUDE_ADVISORY = [
  MODEL_INCLUDE,
  '',
  'This repo pins the pstack-claude catalog. The model sheet is `.claude/pstack-models.md`. Run `node scripts/setup-pstack-claude.mjs` to install that sheet from the pin.',
].join('\n')

try {
  const root = process.cwd()
  const pin = readPin(root)
  const checkout = clonePinned(pin)
  copyProfile(checkout, pin.profile, path.join(root, '.claude', 'pstack-models.md'))
  const claudeFile = path.join(root, 'CLAUDE.md')
  const target = existsSync(claudeFile) ? claudeFile : path.join(root, 'AGENTS.md')
  const body = omitPresentLine(target, CLAUDE_ADVISORY, MODEL_INCLUDE)
  if (target === claudeFile) appendSection(target, '## pstack', body)
  else ensureSectionParagraph(target, '## pstack', body, true)
  process.stdout.write('sheet ok\n')
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
