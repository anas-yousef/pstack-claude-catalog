import { readFileSync } from 'node:fs'
import path from 'node:path'

const SHA = /^[0-9a-f]{40}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/

export function readPin(root) {
  const file = path.join(root, '.claude', 'pstack-claude-pin.json')
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`cannot read ${file}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('pin must be an object')
  if (typeof parsed.repo !== 'string' || !parsed.repo.startsWith('https://')) throw new Error('pin repo must be an https URL')
  if (!SHA.test(parsed.commit)) throw new Error('pin commit must be 40 hex characters')
  if (!SLUG.test(parsed.profile) || !SLUG.test(parsed.codexProfile)) throw new Error('pin profile names must be plain slugs')
  if (!Array.isArray(parsed.plugins) || parsed.plugins.length === 0 || parsed.plugins.some((name) => !SLUG.test(name))) {
    throw new Error('pin plugins must be plain slugs')
  }
  return {
    repo: parsed.repo,
    commit: parsed.commit,
    profile: parsed.profile,
    codexProfile: parsed.codexProfile,
    plugins: parsed.plugins.slice(),
  }
}
