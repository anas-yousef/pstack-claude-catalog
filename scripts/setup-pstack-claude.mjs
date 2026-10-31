#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { appendSection, ensureSectionParagraph, omitPresentLine } from './lib/advisory.mjs'
import { clonePinned } from './lib/clone.mjs'
import { readPin } from './lib/pin.mjs'
import { copyProfile, sessionSettings } from './lib/sheet.mjs'

const MODEL_INCLUDE = '@.claude/pstack-models.md'
const CLAUDE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const CLAUDE_ADVISORY = [
  MODEL_INCLUDE,
  '',
  'This repo pins the pstack-claude catalog. The model sheet is `.claude/pstack-models.md`. Run `node scripts/setup-pstack-claude.mjs` to install that sheet from the pin.',
].join('\n')

function writeSettings(file, session) {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
  let current = {}
  if (raw !== '') {
    try {
      current = JSON.parse(raw)
    } catch {
      throw new Error(`cannot read ${file}`)
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error(`${file} must be an object`)
  }
  current.model = session.model
  if (CLAUDE_EFFORT.has(session.effort)) current.effortLevel = session.effort
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (next === raw) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}

try {
  const root = process.cwd()
  const pin = readPin(root)
  const checkout = clonePinned(pin)
  const sheet = copyProfile(checkout, pin.profile, path.join(root, '.claude', 'pstack-models.md'))
  writeSettings(path.join(root, '.claude', 'settings.json'), sessionSettings(sheet))
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
