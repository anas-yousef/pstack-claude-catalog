import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function assignment(key, value) {
  const rendered = typeof value === 'boolean' ? (value ? 'true' : 'false') : `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  return `${key} = ${rendered}`
}

function nextTable(text, from = 0) {
  let mode = ''
  let lineStart = from === 0 || text[from - 1] === '\n'
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (mode.length === 3) {
      if (text.startsWith(mode, index)) {
        mode = ''
        index += 2
      }
      lineStart = char === '\n'
      continue
    }
    if (mode) {
      if (char === '\\' && mode === '"') index += 1
      else if (char === mode) mode = ''
      lineStart = char === '\n'
      continue
    }
    if ((char === '"' || char === "'") && text.startsWith(char.repeat(3), index)) {
      mode = char.repeat(3)
      index += 2
      lineStart = false
      continue
    }
    if (char === '"' || char === "'") {
      mode = char
      lineStart = false
      continue
    }
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1
      lineStart = true
      continue
    }
    if (lineStart && char === '[') return index
    lineStart = char === '\n' || (lineStart && (char === ' ' || char === '\t'))
  }
  return -1
}

function setRoot(head, keys) {
  const lines = head.split('\n')
  if (head.endsWith('\n')) lines.pop()
  for (const [key, value] of Object.entries(keys)) {
    const line = assignment(key, value)
    const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)
    const index = lines.findIndex((item) => pattern.test(item.trim()))
    if (index === -1) lines.push(line)
    else {
      const comment = lines[index].match(/(\s+#.*)$/)
      const rendered = comment ? `${line}${comment[1]}` : line
      if (lines[index] !== rendered) lines[index] = rendered
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

function replaceTables(tail, tables) {
  const names = Object.keys(tables)
  if (names.length === 0) return tail
  let cursor = 0
  let next = ''
  const seen = new Set()
  while (cursor < tail.length) {
    const start = nextTable(tail, cursor)
    if (start === -1) {
      next += tail.slice(cursor)
      break
    }
    next += tail.slice(cursor, start)
    const lineEnd = tail.indexOf('\n', start)
    const headerLine = tail.slice(start, lineEnd === -1 ? tail.length : lineEnd)
    const name = headerLine.trim().replace(/^\[+/, '').replace(/\]+$/, '')
    const nextHeader = nextTable(tail, lineEnd === -1 ? tail.length : lineEnd + 1)
    const blockEnd = nextHeader === -1 ? tail.length : nextHeader
    if (Object.hasOwn(tables, name)) {
      const lines = [`[${name}]`]
      for (const [key, value] of Object.entries(tables[name])) lines.push(assignment(key, value))
      const trailing = tail.slice(start, blockEnd).match(/\n*$/)?.[0] ?? '\n'
      next += `${lines.join('\n')}\n${trailing.slice(1)}`
      seen.add(name)
    } else {
      next += tail.slice(start, blockEnd)
    }
    cursor = blockEnd
  }
  const extra = []
  for (const name of names) {
    if (seen.has(name)) continue
    const lines = [`[${name}]`]
    for (const [key, value] of Object.entries(tables[name])) lines.push(assignment(key, value))
    extra.push(lines.join('\n'))
  }
  if (extra.length === 0) return next
  if (next.length > 0 && !next.endsWith('\n')) next += '\n'
  if (next.length > 0 && !next.endsWith('\n\n')) next += '\n'
  return `${next}${extra.join('\n\n')}\n`
}

function readBytes(file) {
  try {
    return readFileSync(file)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export function writeConfig(file, spec = {}) {
  const bytes = readBytes(file)
  let text = ''
  if (bytes && bytes.includes(0)) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(`${file}.bak`, bytes)
    process.stdout.write(`backed up ${file} to ${file}.bak\n`)
  } else if (bytes) text = bytes.toString('utf8')
  const endAt = nextTable(text)
  const end = endAt === -1 ? text.length : endAt
  const next = setRoot(text.slice(0, end), spec.root ?? {}) + replaceTables(text.slice(end), spec.tables ?? {})
  if (next === text) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}
