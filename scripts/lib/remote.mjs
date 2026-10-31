import { readFileSync } from 'node:fs'
import path from 'node:path'

const SHA = /^[0-9a-f]{40}$/

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
  const match = /([0-9a-f]{40}) refs\/heads\/main/.exec(await response.text())
  if (!match || !SHA.test(match[1])) throw new Error(`no main commit at ${repo}`)
  return match[1]
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
  const response = await fetch(`https://raw.githubusercontent.com/${githubSlug(repo)}/${commit}/${rel}`, {
    headers: { 'User-Agent': 'pstack-claude-catalog' },
  })
  if (!response.ok) {
    const error = new Error(`cannot read ${rel} at ${commit}`)
    error.status = response.status
    throw error
  }
  return response.text()
}
