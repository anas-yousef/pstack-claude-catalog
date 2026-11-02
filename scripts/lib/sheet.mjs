import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const MAIN_SESSION = 'main session'

function roleEntries(line) {
  const match = /^([a-z][^:\n]*):\s+(\S.*)$/.exec(line)
  if (!match) return null
  const name = match[1]
  if (name === 'default effort' || name === 'panel vendors') return null
  const models = []
  const efforts = []
  for (const part of match[2].split(',')) {
    const entry = part.trim()
    if (!entry) continue
    const [slug, effort] = entry.split(/\s+@/)
    models.push(slug)
    if (effort) efforts.push(effort)
  }
  return { name, models, efforts }
}

export function sessionSettings(sheet) {
  let session = null
  for (const line of sheet.split('\n')) {
    const role = roleEntries(line)
    if (role?.name === MAIN_SESSION) session = role
  }
  if (!session) throw new Error('sheet has no main session row')
  const slug = session.models[0]
  const effort = session.efforts[0]
  if (!slug || slug === 'inherit-parent' || slug === 'auto') throw new Error('main session row has no model')
  if (!EFFORTS.has(effort)) throw new Error('main session row has no effort')
  return { model: slug, effort }
}

const BEGIN = '<!-- pstack:begin -->'
const END = '<!-- pstack:end -->'

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

export function putPstack(file, runtime) {
  const current = readOrEmpty(file)
  const managed = /<!-- pstack:begin -->[\s\S]*?<!-- pstack:end -->\n?/
  const hasBlock = current.includes(BEGIN) && current.includes(END)
  const lines = current.split('\n')
  const start = lines.indexOf('## pstack')
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line))
  const outside = hasBlock
    ? current.replace(managed, '')
    : (start < 0 ? current : [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)].join('\n'))
  const body = [
    'poteto-mode is the only entry point. Inside it, a from-scratch rebuild of an old repo (the current one or one named by path or URL) starts with pstack-extras `greenfield`; any other new product or feature, including one in an existing repo, starts with `pstack-extras:prd` (not any other PRD skill), then spec-driven-development, then build-auto. Changes to existing behavior, refactors, and bug fixes use poteto-mode\'s own playbooks.',
    runtime !== 'claude' ? 'For pstack skills, Codex must read .codex/pstack-models.md; Claude must read .claude/pstack-models.md. Use your runtime\'s sheet for role overrides.' : '',
    runtime !== 'claude' ? 'For Codex `spawn_agent`, task names must use only lowercase letters, digits, and underscores; replace spaces and hyphens in role names with underscores (for example, `how explorer` becomes `how_explorer`).' : '',
    runtime !== 'codex' && !/^@\.claude\/pstack-models\.md$/m.test(outside) ? '@.claude/pstack-models.md' : '',
    runtime !== 'codex' ? 'Model sheet: .claude/pstack-models.md.' : '',
    'Run node scripts/pstack-claude-check.mjs as a single command (no chaining); it prints its own status.',
  ].filter(Boolean).join('\n')
  const block = `${BEGIN}\n${body}\n${END}\n`
  const kept = (hasBlock ? current.replace(managed, block) : outside).trimEnd()
  const next = hasBlock ? `${kept}\n` : (kept ? `${kept}\n\n${block}` : block)
  if (next === current) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}
