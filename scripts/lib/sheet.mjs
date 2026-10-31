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
const BODY = [
  '@.claude/pstack-models.md',
  'Model sheet: .claude/pstack-models.md. Run exactly node scripts/check-pstack.mjs at session start and report pin vs main.',
].join('\n')

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

function isHeading(line) {
  return /^#{1,6} /.test(line)
}

function writeText(file, current, next) {
  if (next === current) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}

function markerBlock() {
  return `${BEGIN}\n${BODY}\n${END}\n`
}

export function putPstack(file) {
  const current = readOrEmpty(file)
  if (current.includes(BEGIN) && current.includes(END)) {
    writeText(file, current, current.replace(/<!-- pstack:begin -->[\s\S]*?<!-- pstack:end -->\n?/, markerBlock()))
    return
  }
  const lines = current.split('\n')
  const start = lines.indexOf('## pstack')
  let kept = current
  if (start !== -1) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (isHeading(lines[index])) {
        end = index
        break
      }
    }
    kept = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n')
  }
  const trimmed = kept.replace(/\s*$/, '')
  writeText(file, current, trimmed === '' ? markerBlock() : `${trimmed}\n\n${markerBlock()}`)
}
