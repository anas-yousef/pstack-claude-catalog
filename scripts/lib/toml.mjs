import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function quote(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function assignment(key, value) {
  const rendered = typeof value === 'boolean' ? (value ? 'true' : 'false') : quote(value)
  return `${key} = ${rendered}`
}

function keyPattern(key) {
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)
}

function splitComment(line) {
  let quote = ''
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 1
        continue
      }
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return { code: line.slice(0, index).trimEnd(), comment: line.slice(index).trim() }
  }
  return { code: line.trimEnd(), comment: '' }
}

function linesOf(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) lines.pop()
  return lines
}

function setKeys(block, entries) {
  const next = block.slice()
  let end = next.length
  while (end > 0 && next[end - 1] === '') end -= 1
  for (const [key, value] of Object.entries(entries)) {
    const line = assignment(key, value)
    const pattern = keyPattern(key)
    const index = next.findIndex((item, at) => at < end && pattern.test(splitComment(item).code.trim()))
    if (index === -1) {
      next.splice(end, 0, line)
      end += 1
    } else {
      const { comment } = splitComment(next[index])
      const rendered = comment ? `${line} ${comment}` : line
      if (next[index] !== rendered) next[index] = rendered
    }
  }
  return next
}

export function editToml(text, spec = {}) {
  const root = spec.root ?? {}
  const tableSpec = spec.tables ?? {}
  const lines = linesOf(text)
  const splitAt = lines.findIndex((line) => /^\s*\[/.test(line))
  const preamble = setKeys(splitAt === -1 ? lines : lines.slice(0, splitAt), root)
  const body = splitAt === -1 ? [] : lines.slice(splitAt)
  const chunks = []
  const loose = []
  let current = null
  for (const line of body) {
    const header = /^\s*\[([^\]\n]+)\]\s*$/.exec(splitComment(line).code)
    if (header) {
      current = { name: header[1].trim(), lines: [line] }
      chunks.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      loose.push(line)
    }
  }
  const seen = new Set()
  for (const chunk of chunks) {
    const entries = tableSpec[chunk.name]
    if (!entries) continue
    seen.add(chunk.name)
    const header = chunk.lines[0]
    chunk.lines = [header, ...setKeys(chunk.lines.slice(1), entries)]
  }
  const flat = preamble.slice()
  const rest = [...loose, ...chunks.flatMap((chunk) => chunk.lines)]
  if (rest.length > 0 && flat.length > 0 && flat[flat.length - 1] !== '') flat.push('')
  flat.push(...rest)
  for (const [name, entries] of Object.entries(tableSpec)) {
    if (seen.has(name)) continue
    if (flat.length > 0 && flat[flat.length - 1] !== '') flat.push('')
    flat.push(`[${name}]`)
    for (const [key, value] of Object.entries(entries)) flat.push(assignment(key, value))
  }
  if (flat.length === 0) return ''
  return `${flat.join('\n')}\n`
}

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

export function writeMerged(file, spec) {
  const current = readOrEmpty(file)
  const next = editToml(current, spec)
  if (next === current) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}
