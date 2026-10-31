#!/usr/bin/env node
import { readPin } from './lib/pin.mjs'
import { catalogMain } from './lib/remote.mjs'

const pin = readPin(process.cwd())
try {
  const catalog = await catalogMain(pin.repo)
  const state = catalog === pin.commit ? 'current' : 'outdated'
  process.stdout.write(`pin ${pin.commit} catalog ${catalog} ${state}\n`)
  if (state !== 'current') process.exit(1)
} catch {
  process.stdout.write(`pin ${pin.commit} (offline: run outside the sandbox to compare)\n`)
}
