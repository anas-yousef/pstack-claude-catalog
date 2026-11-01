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
  const body = [
    runtime === 'claude'
      ? '@.claude/pstack-models.md\nModel sheet: .claude/pstack-models.md.'
      : 'For pstack skills, Codex must read .codex/pstack-models.md; Claude must read .claude/pstack-models.md. Use your runtime\'s sheet for role overrides.',
    'Run node scripts/check-pstack.mjs as a single command (no chaining); it prints its own status.',
  ].join('\n')
  const block = `${BEGIN}\n${body}\n${END}\n`
  const lines = current.split('\n')
  const start = lines.indexOf('## pstack')
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line))
  const kept = (current.includes(BEGIN) && current.includes(END)
    ? current.replace(/<!-- pstack:begin -->[\s\S]*?<!-- pstack:end -->\n?/, block)
    : (start < 0 ? current : [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)].join('\n'))
  ).replace(/\s*$/, '')
  const next = current.includes(BEGIN) && current.includes(END) ? `${kept}\n` : (kept ? `${kept}\n\n${block}` : block)
  if (next === current) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}
