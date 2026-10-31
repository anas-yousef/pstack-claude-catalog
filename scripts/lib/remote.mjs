import { readFileSync } from 'node:fs'
import path from 'node:path'

export const SHA = /^[0-9a-f]{40}$/

export function rawUrl(repo, commit, rel) {
  if (process.env.PSTACK_RAW) return `${process.env.PSTACK_RAW}/${commit}/${rel}`
  return `https://raw.githubusercontent.com/${githubSlug(repo)}/${commit}/${rel}`
}

export function githubSlug(repo) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(repo)
  if (!match) throw new Error('pin repo must be a GitHub https URL')
  return match[1]
}

export async function catalogMain(repo) {
  const remote = repo.endsWith('.git') ? repo : `${repo}.git`
  const response = await fetch(`${remote}/info/refs?service=git-upload-pack`, {
    headers: { 'User-Agent': 'pstack-claude-catalog' },
  })
  if (!response.ok) throw new Error(`cannot read main at ${repo}`)
  const text = await response.text()
  const marker = ' refs/heads/main'
  const at = text.indexOf(marker)
  const sha = at >= 40 ? text.slice(at - 40, at) : ''
  if (!SHA.test(sha)) throw new Error(`no main commit at ${repo}`)
  return sha
}

export async function fetchCatalogText(repo, commit, rel) {
  if (process.env.PSTACK_CATALOG) {
    try {
      return readFileSync(path.join(process.env.PSTACK_CATALOG, rel), 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const missing = new Error(`missing ${rel}`)
      missing.status = 404
      throw missing
    }
  }
  const response = await fetch(rawUrl(repo, commit, rel), {
    headers: { 'User-Agent': 'pstack-claude-catalog' },
  })
  if (!response.ok) {
    const error = new Error(`cannot read ${rel} at ${commit}`)
    error.status = response.status
    throw error
  }
  return response.text()
}
