#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readPin } from './lib/pin.mjs'
import { fetchCatalogText } from './lib/remote.mjs'

const owned = JSON.parse(readFileSync(new URL('./lib/owned.json', import.meta.url), 'utf8'))

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function main() {
  if (process.argv.length > 2) {
    process.stderr.write('usage: node scripts/sync-pstack.mjs\n')
    process.exit(1)
  }
  const root = process.cwd()
  const pin = readPin(root)
  for (const rel of owned) {
    const next = await fetchCatalogText(pin.repo, pin.commit, rel)
    const file = path.join(root, rel)
    if (readOrEmpty(file) === next) continue
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, next)
  }
  process.stdout.write('sync ok\n')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
