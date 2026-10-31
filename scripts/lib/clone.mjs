import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const SHA = /^[0-9a-f]{40}$/

function gitEnv(blank) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      key === 'GIT_CONFIG_COUNT'
      || key.startsWith('GIT_CONFIG_KEY_')
      || key.startsWith('GIT_CONFIG_VALUE_')
      || key === 'GH_TOKEN'
      || key === 'GITHUB_TOKEN'
      || key === 'GH_ENTERPRISE_TOKEN'
    ) {
      delete env[key]
    }
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_CONFIG_GLOBAL = blank
  env.GIT_CONFIG_SYSTEM = blank
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_COUNT = '1'
  env.GIT_CONFIG_KEY_0 = 'credential.helper'
  env.GIT_CONFIG_VALUE_0 = ''
  return env
}

function git(args, cwd, env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || '').trim()
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout
}

function headOf(dir, env) {
  if (!existsSync(path.join(dir, '.git'))) return ''
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env, encoding: 'utf8' })
  if (result.status !== 0) return ''
  return (result.stdout || '').trim()
}

function cacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache')
  return path.join(base, 'pstack-claude-catalog')
}

export function clonePinned(pin) {
  const dest = path.join(cacheDir(), pin.commit)
  const blank = path.join(cacheDir(), 'gitconfig')
  mkdirSync(path.dirname(dest), { recursive: true })
  if (!existsSync(blank)) writeFileSync(blank, '')
  const env = gitEnv(blank)
  if (headOf(dest, env) === pin.commit) return dest
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  git(['init', '-q'], dest, env)
  const url = pin.repo.endsWith('.git') ? pin.repo : `${pin.repo}.git`
  git(['fetch', '-q', '--depth', '1', url, pin.commit], dest, env)
  git(['checkout', '-q', '--detach', 'FETCH_HEAD'], dest, env)
  const head = headOf(dest, env)
  if (!SHA.test(head) || head !== pin.commit) throw new Error(`clone of ${pin.repo} is ${head || 'empty'}, not ${pin.commit}`)
  return dest
}
