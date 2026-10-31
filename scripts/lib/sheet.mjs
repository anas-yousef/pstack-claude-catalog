import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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

export function agentsPaste(sheet) {
  const lines = []
  for (const line of sheet.split('\n')) {
    if (/^default effort:\s+\S+/.test(line) || /^The effort listed for a role is a minimum\b/.test(line) || roleEntries(line)) {
      lines.push(line)
    }
  }
  return lines.join('\n')
}

export function copyProfile(checkout, name, dest) {
  const source = path.join(checkout, 'profiles', `${name}.md`)
  if (!existsSync(source)) throw new Error(`no profile ${name} in the pinned catalog`)
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(source, dest)
  return readFileSync(dest, 'utf8')
}

export function codexHome() {
  return process.env.CODEX_HOME || path.join(homedir(), '.codex')
}

const BEGIN = '<!-- pstack:begin -->'
const END = '<!-- pstack:end -->'
const INCLUDE = '@.claude/pstack-models.md'
const CHECK = 'node scripts/check-pstack.mjs'

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

function headingSpan(text, heading) {
  const lines = text.replace(/\n$/, '').split('\n')
  const start = lines.indexOf(heading)
  let end = lines.length
  for (let index = start + 1; start !== -1 && index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index
      break
    }
  }
  return { lines, start, end }
}

function writeText(file, current, next) {
  if (next === current) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}

export function putPstack(file) {
  const current = readOrEmpty(file)
  const bare = current.replace(/<!-- pstack:begin -->[\s\S]*?<!-- pstack:end -->\n?/, '')
  const { lines, start, end } = headingSpan(bare, '## pstack')
  const kept = (start === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end)]).join('\n').replace(/\n{3,}/g, '\n\n')
  const body = kept.split('\n').includes(INCLUDE) ? CHECK : `${INCLUDE}\n${CHECK}`
  const block = `${BEGIN}\n${body}\n${END}\n`
  const trimmed = kept.replace(/\s*$/, '')
  writeText(file, current, trimmed === '' ? block : `${trimmed}\n\n${block}`)
}

export function putSection(file, heading, body) {
  const current = readOrEmpty(file)
  const block = `${heading}\n\n${body.trim()}\n`
  const { lines, start, end } = headingSpan(current, heading)
  const next = start === -1
    ? (current === '' ? block : `${current.endsWith('\n') ? current : `${current}\n`}\n${block}`)
    : `${[...lines.slice(0, start), ...block.replace(/\n$/, '').split('\n'), ...lines.slice(end)].join('\n')}\n`
  writeText(file, current, next)
}
