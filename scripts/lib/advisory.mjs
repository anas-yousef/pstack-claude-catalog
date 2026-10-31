import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

function writeIfChanged(file, current, next) {
  if (next === current) return false
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
  return true
}

export const CHECK_LINE = 'Run node scripts/check-pstack.mjs to compare this pin with the catalog. The command only reads.'

export function omitPresentLine(file, body, line) {
  const current = readOrEmpty(file)
  if (!current.split('\n').includes(line)) return body
  return body.split('\n').filter((part) => part !== line).join('\n').trim()
}

export function appendSection(file, heading, body) {
  const current = readOrEmpty(file)
  const lines = current === '' ? [] : current.split('\n')
  if (lines.includes(heading)) return false
  const section = `${heading}\n\n${body.trim()}\n`
  const next = current === '' ? section : `${current.endsWith('\n') ? current : `${current}\n`}\n${section}`
  return writeIfChanged(file, current, next)
}

function sectionEnd(lines, start) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) return index
  }
  return lines.length
}

function sectionBody(lines, start, end) {
  const raw = lines.slice(start + 1, end)
  let from = 0
  let to = raw.length
  while (from < to && raw[from] === '') from += 1
  while (to > from && raw[to - 1] === '') to -= 1
  return raw.slice(from, to)
}

export function ensureSectionParagraph(file, heading, paragraph, leading = false) {
  const block = paragraph.trim()
  const current = readOrEmpty(file)
  const lines = current === '' ? [] : current.replace(/\n$/, '').split('\n')
  const start = lines.indexOf(heading)
  if (start === -1) return appendSection(file, heading, block)
  const end = sectionEnd(lines, start)
  if (lines.slice(start + 1, end).join('\n').includes(block)) return false
  const content = sectionBody(lines, start, end)
  const insertion = block.split('\n')
  let nextContent = insertion
  if (content.length > 0 && leading) nextContent = [...insertion, '', ...content]
  if (content.length > 0 && !leading) nextContent = [...content, '', ...insertion]
  const tail = lines.slice(end)
  const parts = [heading, '', ...nextContent]
  if (tail.length > 0 && tail[0] !== '') parts.push('')
  const merged = [...lines.slice(0, start), ...parts, ...tail]
  return writeIfChanged(file, current, `${merged.join('\n')}\n`)
}

export function replaceSection(file, heading, body) {
  const current = readOrEmpty(file)
  const block = `${heading}\n\n${body.trim()}\n`
  const lines = current === '' ? [] : current.replace(/\n$/, '').split('\n')
  const start = lines.indexOf(heading)
  let next
  if (start === -1) {
    next = current === '' ? block : `${current.endsWith('\n') ? current : `${current}\n`}\n${block}`
  } else {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index].startsWith('## ')) {
        end = index
        break
      }
    }
    const merged = [...lines.slice(0, start), ...block.replace(/\n$/, '').split('\n'), ...lines.slice(end)]
    next = `${merged.join('\n')}\n`
  }
  return writeIfChanged(file, current, next)
}
