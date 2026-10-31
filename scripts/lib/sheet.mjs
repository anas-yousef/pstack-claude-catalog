import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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
