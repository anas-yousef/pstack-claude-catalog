#!/usr/bin/env node
import { readPin } from './lib/pin.mjs'
import { catalogMain } from './lib/remote.mjs'

const OFFLINE = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'])

function offline(error) {
  const code = error?.code || error?.cause?.code
  if (OFFLINE.has(code)) return true
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true
  if (error?.cause && (error.cause.name === 'TimeoutError' || error.cause.name === 'AbortError')) return true
  return error instanceof TypeError && error.message === 'fetch failed'
}

function report(kind, code) {
  process.stdout.write(`pstack: ${kind} (exit ${code})\n`)
  process.exit(code)
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
  report(catalog === pin.commit ? 'current' : 'outdated', catalog === pin.commit ? 0 : 1)
} catch (error) {
  if (!offline(error)) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
  report('offline', 0)
}
