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

export function appendSection(file, heading, body) {
  const current = readOrEmpty(file)
  const lines = current === '' ? [] : current.split('\n')
  if (lines.includes(heading)) return false
  const section = `${heading}\n\n${body.trim()}\n`
  const next = current === '' ? section : `${current.endsWith('\n') ? current : `${current}\n`}\n${section}`
  return writeIfChanged(file, current, next)
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
