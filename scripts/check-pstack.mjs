#!/usr/bin/env node
import { readPin } from './lib/pin.mjs'
import { catalogMain } from './lib/remote.mjs'

const OFFLINE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])

function isOffline(error) {
  if (!error) return false
  const code = error.code || error.cause?.code
  if (OFFLINE.has(code)) return true
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true
  if (error.cause && (error.cause.name === 'TimeoutError' || error.cause.name === 'AbortError')) return true
  return error instanceof TypeError && error.message === 'fetch failed'
}

let pin
try {
  pin = readPin(process.cwd())
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
try {
  const catalog = await catalogMain(pin.repo)
  const state = catalog === pin.commit ? 'current' : 'outdated'
  process.stdout.write(`pin ${pin.commit} catalog ${catalog} ${state}\n`)
  if (state !== 'current') process.exit(1)
} catch (error) {
  if (!isOffline(error)) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  process.stdout.write(`pin ${pin.commit} (offline: run outside the sandbox to compare)\n`)
}
