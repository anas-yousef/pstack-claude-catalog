import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function assign(key, value) {
  const rendered = typeof value === 'boolean' ? (value ? 'true' : 'false') : `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  return `${key} = ${rendered}`
}

function mask(text) {
  return text.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g, (part) => ' '.repeat(part.length))
}

function tableAt(text) {
  const masked = mask(text)
  const indexes = []
  const re = /^[ \t]*\[/gm
  let match
  while ((match = re.exec(masked))) indexes.push(match.index + match[0].length - 1)
  return indexes
}

function tableName(line) {
  const match = /^\[\[?\s*([^[\]]*?)\s*\]\]?$/.exec(line.replace(/\s+#.*$/, '').trim())
  return match ? match[1].trim() : ''
}

function setRoot(head, keys) {
  const chunks = head.split(/("""[\s\S]*?"""|'''[\s\S]*?''')/)
  const found = new Set()
  for (let index = 0; index < chunks.length; index += 2) {
    const newline = chunks[index].endsWith('\n')
    const lines = chunks[index].split('\n')
    if (newline) lines.pop()
    for (const [key, value] of Object.entries(keys)) {
      const at = lines.findIndex((line) => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).test(line.trim()))
      if (at < 0) continue
      found.add(key)
      const comment = lines[at].match(/\s+#.*$/)
      const rendered = assign(key, value)
      lines[at] = comment ? `${rendered}${comment[0]}` : rendered
    }
    chunks[index] = lines.length === 0 ? (newline ? '\n' : '') : `${lines.join('\n')}${newline ? '\n' : ''}`
  }
  const missing = Object.entries(keys).filter(([key]) => !found.has(key))
  const body = chunks.join('')
  if (missing.length === 0) return body
  const addition = missing.map(([key, value]) => assign(key, value)).join('\n')
  return `${body.replace(/\s*$/, '')}\n${addition}\n`
}

function replaceTables(tail, tables) {
  const names = Object.keys(tables)
  if (names.length === 0) return tail
  const spans = tableAt(tail)
  let cursor = 0
  let next = ''
  const seen = new Set()
  for (let index = 0; index < spans.length; index += 1) {
    const start = spans[index]
    const end = index + 1 < spans.length ? spans[index + 1] : tail.length
    next += tail.slice(cursor, start)
    const lineEnd = tail.indexOf('\n', start)
    const name = tableName(tail.slice(start, lineEnd === -1 ? tail.length : lineEnd))
    if (Object.hasOwn(tables, name)) {
      const lines = [`[${name}]`, ...Object.entries(tables[name]).map(([key, value]) => assign(key, value))]
      const trailing = tail.slice(start, end).match(/\n*$/)?.[0] ?? '\n'
      next += `${lines.join('\n')}\n${trailing.slice(1)}`
      seen.add(name)
    } else next += tail.slice(start, end)
    cursor = end
  }
  next += tail.slice(cursor)
  const extra = names.filter((name) => !seen.has(name)).map((name) => [`[${name}]`, ...Object.entries(tables[name]).map(([key, value]) => assign(key, value))].join('\n'))
  if (extra.length === 0) return next
  if (next.length > 0 && !next.endsWith('\n')) next += '\n'
  if (next.length > 0 && !next.endsWith('\n\n')) next += '\n'
  return `${next}${extra.join('\n\n')}\n`
}

export function writeConfig(file, spec = {}) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const at = tableAt(text)[0] ?? text.length
  const next = setRoot(text.slice(0, at), spec.root ?? {}) + replaceTables(text.slice(at), spec.tables ?? {})
  if (next === text) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}
