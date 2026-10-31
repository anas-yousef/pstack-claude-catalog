import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { codexTables } from './codex-config.mjs'
import { githubSlug } from './remote.mjs'
import { putPstack, sessionSettings } from './sheet.mjs'
import { writeConfig } from './toml.mjs'

const EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])
const ALLOW = 'Bash(node scripts/check-pstack.mjs:*)'
const STALE_ALLOW = new Set([
  'Bash(node scripts/check-pstack.mjs)',
  'Bash(node scripts/check-pstack.mjs *)',
])

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function readSettings(file) {
  if (!existsSync(file)) return { raw: '', current: {} }
  const raw = readFileSync(file, 'utf8')
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
    return { raw, current: parsed }
  } catch {
    writeFileSync(`${file}.bak`, raw)
    process.stdout.write(`backed up ${file} to ${file}.bak\n`)
    return { raw, current: {} }
  }
}

function writeSettings(file, session, pin, marketplace) {
  const { raw, current } = readSettings(file)
  current.model = session.model
  if (EFFORT.has(session.effort)) current.effortLevel = session.effort
  else delete current.effortLevel
  const permissions = asObject(current.permissions)
  const allow = Array.isArray(permissions.allow) ? permissions.allow.filter((rule) => typeof rule === 'string' && !STALE_ALLOW.has(rule)) : []
  if (!allow.includes(ALLOW)) allow.push(ALLOW)
  permissions.allow = allow
  current.permissions = permissions
  const markets = asObject(current.extraKnownMarketplaces)
  markets[marketplace] = { source: { source: 'github', repo: githubSlug(pin.repo) } }
  current.extraKnownMarketplaces = markets
  const enabled = asObject(current.enabledPlugins)
  for (const plugin of pin.plugins) enabled[`${plugin}@${marketplace}`] = true
  current.enabledPlugins = enabled
  const next = `${JSON.stringify(current, null, 2)}\n`
  if (next === raw) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}

function claudeHomeFile() {
  return path.join(homedir(), '.claude.json')
}

function codexHomeFile() {
  return path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml')
}

function readClaude(file) {
  if (!existsSync(file)) return { raw: '', parsed: {} }
  const raw = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${file} is not JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} must be an object`)
  return { raw, parsed }
}

export function assertHomes() {
  readClaude(claudeHomeFile())
  const file = codexHomeFile()
  if (!existsSync(file)) return
  if (readFileSync(file).includes(0)) throw new Error(`${file} is not text`)
}

function alreadyTrusted(parsed, repo) {
  const projects = parsed.projects
  const entry = projects && typeof projects === 'object' && !Array.isArray(projects) ? projects[repo] : null
  return !!entry && typeof entry === 'object' && !Array.isArray(entry) && entry.hasTrustDialogAccepted === true
}

function withTrust(parsed, repo) {
  const next = JSON.parse(JSON.stringify(parsed))
  if (!next.projects || typeof next.projects !== 'object' || Array.isArray(next.projects)) next.projects = {}
  if (!next.projects[repo] || typeof next.projects[repo] !== 'object' || Array.isArray(next.projects[repo])) next.projects[repo] = {}
  next.projects[repo].hasTrustDialogAccepted = true
  return next
}

function indentUnit(raw) {
  const match = raw.match(/\n([ \t]+)\S/)
  if (!match) return null
  return match[1].includes('\t') ? '\t' : match[1].length
}

function renderJson(value, unit, trailing) {
  const body = JSON.stringify(value, null, unit)
  return trailing ? `${body}\n` : body
}

function skipWs(text, index) {
  let cursor = index
  while (cursor < text.length && ' \t\r\n'.includes(text[cursor])) cursor += 1
  return cursor
}

function parseStringEnd(text, index) {
  let cursor = index + 1
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2
      continue
    }
    if (text[cursor] === '"') return cursor + 1
    cursor += 1
  }
  throw new Error('unterminated string')
}

function parseValueEnd(text, index) {
  const cursor = skipWs(text, index)
  const char = text[cursor]
  if (char === '"') return parseStringEnd(text, cursor)
  if (char === '{' || char === '[') {
    const close = char === '{' ? '}' : ']'
    let depth = 0
    let at = cursor
    while (at < text.length) {
      if (text[at] === '"') {
        at = parseStringEnd(text, at)
        continue
      }
      if (text[at] === char) depth += 1
      else if (text[at] === close) {
        depth -= 1
        if (depth === 0) return at + 1
      }
      at += 1
    }
    throw new Error('unterminated value')
  }
  let at = cursor
  while (at < text.length && !' \t\r\n,}]'.includes(text[at])) at += 1
  return at
}

function objectEntries(text, open) {
  let cursor = open + 1
  const entries = []
  while (cursor < text.length) {
    cursor = skipWs(text, cursor)
    if (text[cursor] === '}') return { entries, end: cursor }
    if (text[cursor] !== '"') throw new Error('expected a key')
    const keyEnd = parseStringEnd(text, cursor)
    const key = JSON.parse(text.slice(cursor, keyEnd))
    const keyStart = cursor
    cursor = skipWs(text, keyEnd)
    if (text[cursor] !== ':') throw new Error('expected a colon')
    const valueStart = skipWs(text, cursor + 1)
    const valueEnd = parseValueEnd(text, valueStart)
    entries.push({ key, keyStart, valueStart, valueEnd })
    cursor = skipWs(text, valueEnd)
    if (text[cursor] === ',') cursor += 1
  }
  throw new Error('unterminated object')
}

function keyIndent(text, keyStart) {
  let cursor = keyStart
  while (cursor > 0 && text[cursor - 1] !== '\n') cursor -= 1
  return text.slice(cursor, keyStart)
}

function unitString(raw) {
  const unit = indentUnit(raw)
  if (unit === '\t') return '\t'
  if (typeof unit === 'number') return ' '.repeat(unit)
  return '  '
}

function trustEntry(indent, unit, repo) {
  const nested = `${indent}${unit}`
  return `${indent}${JSON.stringify(repo)}: {\n${nested}"hasTrustDialogAccepted": true\n${indent}}`
}

function appendProp(raw, entries, propText) {
  const last = entries[entries.length - 1]
  return `${raw.slice(0, last.valueEnd)},\n${propText}${raw.slice(last.valueEnd)}`
}

function patchPretty(raw, repo) {
  const unit = unitString(raw)
  const root = objectEntries(raw, skipWs(raw, 0))
  const rootIndent = root.entries.length ? keyIndent(raw, root.entries[0].keyStart) : unit
  const projects = root.entries.find((entry) => entry.key === 'projects')
  if (!projects) {
    const inserted = `${rootIndent}"projects": {\n${trustEntry(`${rootIndent}${unit}`, unit, repo)}\n${rootIndent}}`
    if (root.entries.length === 0) return `{\n${inserted}\n}\n`
    return appendProp(raw, root.entries, inserted)
  }
  if (raw[projects.valueStart] !== '{') {
    const indent = `${keyIndent(raw, projects.keyStart)}${unit}`
    const body = `{\n${trustEntry(indent, unit, repo)}\n${keyIndent(raw, projects.keyStart)}}`
    return `${raw.slice(0, projects.valueStart)}${body}${raw.slice(projects.valueEnd)}`
  }
  const project = objectEntries(raw, projects.valueStart)
  const projectIndent = project.entries.length ? keyIndent(raw, project.entries[0].keyStart) : `${keyIndent(raw, projects.keyStart)}${unit}`
  const current = project.entries.find((entry) => entry.key === repo)
  if (!current) {
    if (project.entries.length === 0) {
      const body = `{\n${trustEntry(projectIndent, unit, repo)}\n${keyIndent(raw, projects.keyStart)}}`
      return `${raw.slice(0, projects.valueStart)}${body}${raw.slice(project.end + 1)}`
    }
    return appendProp(raw, project.entries, trustEntry(projectIndent, unit, repo))
  }
  if (raw[current.valueStart] !== '{') {
    const body = `{\n${projectIndent}${unit}"hasTrustDialogAccepted": true\n${projectIndent}}`
    return `${raw.slice(0, current.valueStart)}${body}${raw.slice(current.valueEnd)}`
  }
  const entry = objectEntries(raw, current.valueStart)
  const trust = entry.entries.find((item) => item.key === 'hasTrustDialogAccepted')
  if (trust) {
    if (raw.slice(trust.valueStart, trust.valueEnd).trim() === 'true') return raw
    return `${raw.slice(0, trust.valueStart)}true${raw.slice(trust.valueEnd)}`
  }
  const flagIndent = entry.entries.length ? keyIndent(raw, entry.entries[0].keyStart) : `${projectIndent}${unit}`
  if (entry.entries.length === 0) {
    const body = `{\n${flagIndent}"hasTrustDialogAccepted": true\n${projectIndent}}`
    return `${raw.slice(0, current.valueStart)}${body}${raw.slice(entry.end + 1)}`
  }
  return appendProp(raw, entry.entries, `${flagIndent}"hasTrustDialogAccepted": true`)
}

function nextClaude(raw, parsed, repo) {
  if (raw && alreadyTrusted(parsed, repo)) return raw
  const unit = raw ? indentUnit(raw) : 2
  if (raw && unit != null) {
    const trailing = raw.endsWith('\n')
    if (renderJson(parsed, unit, trailing) === raw) return renderJson(withTrust(parsed, repo), unit, trailing)
    return patchPretty(raw, repo)
  }
  return renderJson(withTrust(parsed, repo), 2, true)
}

function writeAtomic(file, text) {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
  try {
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

function trustClaude(repo) {
  const file = claudeHomeFile()
  const { raw, parsed } = readClaude(file)
  const next = nextClaude(raw, parsed, repo)
  if (next === raw) return
  writeAtomic(file, next)
}

export function install(root, pin, claudeSheet, codexSheet, marketplace) {
  const claudeDir = path.join(root, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(path.join(claudeDir, 'pstack-models.md'), claudeSheet)
  writeSettings(path.join(claudeDir, 'settings.json'), sessionSettings(claudeSheet), pin, marketplace)
  const claudeFile = path.join(root, 'CLAUDE.md')
  if (existsSync(claudeFile)) putPstack(claudeFile)
  putPstack(path.join(root, 'AGENTS.md'))
  const session = sessionSettings(codexSheet)
  const abs = path.resolve(root)
  const quoted = abs.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  writeConfig(path.join(root, '.codex', 'config.toml'), {
    root: { model: session.model, model_reasoning_effort: session.effort },
    tables: codexTables(pin, marketplace),
  })
  const home = process.env.CODEX_HOME || path.join(homedir(), '.codex')
  mkdirSync(home, { recursive: true })
  writeConfig(path.join(home, 'config.toml'), {
    tables: { [`projects."${quoted}"`]: { trust_level: 'trusted' } },
  })
  trustClaude(abs)
}
