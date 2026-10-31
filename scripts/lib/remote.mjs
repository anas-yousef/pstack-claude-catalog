import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const SHA = /^[0-9a-f]{40}$/

export function githubSlug(repo) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(repo)
  if (!match) throw new Error('pin repo must be a GitHub https URL')
  return match[1]
}

function cachedFile(commit, rel) {
  const base = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache')
  return path.join(base, 'pstack-claude-catalog', commit, rel)
}

export async function catalogMain(repo) {
  const remote = repo.endsWith('.git') ? repo : `${repo}.git`
  const response = await fetch(`${remote}/info/refs?service=git-upload-pack`, {
    headers: { 'User-Agent': 'pstack-claude-catalog' },
  })
  if (!response.ok) throw new Error(`cannot read main at ${repo}`)
  const match = /([0-9a-f]{40}) refs\/heads\/main/.exec(await response.text())
  if (!match || !SHA.test(match[1])) throw new Error(`no main commit at ${repo}`)
  return match[1]
}

export async function fetchCatalogText(repo, commit, rel) {
  if (process.env.PSTACK_CATALOG) return readFileSync(path.join(process.env.PSTACK_CATALOG, rel), 'utf8')
  const cached = cachedFile(commit, rel)
  if (existsSync(cached)) return readFileSync(cached, 'utf8')
  const url = `https://raw.githubusercontent.com/${githubSlug(repo)}/${commit}/${rel}`
  const response = await fetch(url, { headers: { 'User-Agent': 'pstack-claude-catalog' } })
  if (response.status === 404) {
    const error = new Error(`missing ${rel} at ${commit}`)
    error.status = 404
    throw error
  }
  if (!response.ok) throw new Error(`cannot read ${rel} at ${commit}`)
  return response.text()
}
