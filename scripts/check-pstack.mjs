#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readPin } from './lib/pin.mjs'
import { catalogMain, fetchCatalogText } from './lib/remote.mjs'

const owned = JSON.parse(readFileSync(new URL('./lib/owned.json', import.meta.url), 'utf8'))

function wantTree(argv) {
  let tree = false
  for (const arg of argv) {
    if (arg === '--tree') tree = true
    else {
      process.stderr.write('usage: node scripts/check-pstack.mjs [--tree]\n')
      process.exit(1)
    }
  }
  return tree
}

async function treeDrift(root, pin) {
  const paths = []
  for (const rel of owned) {
    let remote = null
    try {
      remote = await fetchCatalogText(pin.repo, pin.commit, rel)
    } catch (error) {
      if (error.status !== 404) throw error
    }
    const file = path.join(root, rel)
    const local = existsSync(file) ? readFileSync(file, 'utf8') : null
    if (local !== remote) paths.push(rel)
  }
  return paths
}

async function main() {
  const tree = wantTree(process.argv.slice(2))
  const root = process.cwd()
  const pin = readPin(root)
  const catalog = await catalogMain(pin.repo)
  const state = catalog === pin.commit ? 'current' : 'outdated'
  process.stdout.write(`pin ${pin.commit} catalog ${catalog} ${state}\n`)
  let drift = false
  if (tree) {
    const paths = await treeDrift(root, pin)
    if (paths.length === 0) process.stdout.write('tree current\n')
    else {
      drift = true
      process.stdout.write('tree drift\n')
      for (const rel of paths) process.stdout.write(`${rel}\n`)
    }
  }
  if (state !== 'current' || drift) process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
