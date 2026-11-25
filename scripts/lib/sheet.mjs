import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const MAIN_SESSION = 'main session'

function roleEntries(line) {
  const match = /^([a-z][^:\n]*):\s+(\S.*)$/.exec(line)
  if (!match) return null
  const name = match[1]
  if (name === 'default effort' || name === 'panel vendors') return null
  const models = []
  const efforts = []
  for (const part of match[2].split(',')) {
    const entry = part.trim()
    if (!entry) continue
    const [slug, effort] = entry.split(/\s+@/)
    models.push(slug)
    if (effort) efforts.push(effort)
  }
  return { name, models, efforts }
}

export function sessionSettings(sheet) {
  let session = null
  for (const line of sheet.split('\n')) {
    const role = roleEntries(line)
    if (role?.name === MAIN_SESSION) session = role
  }
  if (!session) throw new Error('sheet has no main session row')
  const slug = session.models[0]
  const effort = session.efforts[0]
  if (!slug || slug === 'inherit-parent' || slug === 'auto') throw new Error('main session row has no model')
  if (!EFFORTS.has(effort)) throw new Error('main session row has no effort')
  return { model: slug, effort }
}

const BEGIN = '<!-- pstack:begin -->'
const END = '<!-- pstack:end -->'

function readOrEmpty(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

// runtime: 'claude', 'codex', 'both', or 'none' (shared lines only).
// options.profiles: catalog profiles URL with a <commit> placeholder; set when the pin's Claude profile is none.
export function putPstack(file, runtime, options = {}) {
  const codex = runtime === 'codex' || runtime === 'both'
  const claude = runtime === 'claude' || runtime === 'both'
  const current = readOrEmpty(file)
  const managed = /<!-- pstack:begin -->[\s\S]*?<!-- pstack:end -->\n?/
  const hasBlock = current.includes(BEGIN) && current.includes(END)
  const lines = current.split('\n')
  const start = lines.indexOf('## pstack')
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line))
  const outside = hasBlock
    ? current.replace(managed, '')
    : (start < 0 ? current : [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)].join('\n'))
  const body = [
    'poteto-mode is the only entry point. Inside it, a from-scratch rebuild of an old repo (the current one or one named by path or URL) starts with pstack-extras `greenfield`; any other new product or feature, including one in an existing repo, starts with `pstack-extras:prd` (not any other PRD skill), then spec-driven-development, then the project\'s design leg when its rules require one, then build-auto. Changes to existing behavior, refactors, and bug fixes use poteto-mode\'s own playbooks. When poteto-mode reviews a pull request, the review itself runs on the `judgment and prose` role: the session hands it to a fresh reviewer on that role and does not review in the main session. Whenever a change touches a browser UI, poteto-mode runs `pstack-extras:ux-critique` after it builds or ships the change and when it reviews a UI pull request. The critique renders every touched screen at desktop and phone widths, in light and dark, in every project locale including RTL, saves the screenshots, and judges them; each finding cites a screenshot, and a review that reads only the diff does not count as the UI review.',
    'Tests that involve time (timeouts, pauses, retries, backoff, circuit breakers, schedulers, debounce, TTLs) use a simulated clock, such as fake timers or an injected clock, never real wall-clock waits or sleeps; real clocks flake on loaded machines. Every test run has a hard timeout, per test and for the whole run, and its processes die when the parent exits. Reviewers flag real-clock waits or sleeps in tests as findings.',
    'Every bug fix includes regression tests that fail before the fix and pass after it, at the right levels: unit, integration against a real database or edge functions, and/or end-to-end in the browser. Reviewers flag a bug fix without such a test as a P1 finding.',
    'Always place imports at the top of the module. Avoid inline imports in function bodies, type annotations, or interface fields unless there is a strict circular-dependency reason and it is documented.',
    'In switch statements over discriminated unions or enums, use a `never` check in the default case so newly added variants cause compile-time failures until handled.',
    codex ? 'For pstack skills, Codex must read .codex/pstack-models.md; Claude must read .claude/pstack-models.md. Use your runtime\'s sheet for role overrides.' : '',
    codex ? 'For Codex `spawn_agent`, task names must use only lowercase letters, digits, and underscores; replace spaces and hyphens in role names with underscores (for example, `how explorer` becomes `how_explorer`).' : '',
    claude && !/^@\.claude\/pstack-models\.md$/m.test(outside) ? '@.claude/pstack-models.md' : '',
    claude ? 'Model sheet: .claude/pstack-models.md.' : '',
    claude && options.profiles ? `No default model profile: if .claude/pstack-models.md is missing, pick the fitting Claude profile from ${options.profiles}/index.json (<commit> from .claude/pstack-claude-pin.json), fetch that profile's <name>.md from the same folder, save it as .claude/pstack-models.md, say which profile you chose, then start; never run pstack roles on built-in defaults.` : '',
    'Run node scripts/pstack-claude-check.mjs as a single command (no chaining); it prints its own status.',
  ].filter(Boolean).join('\n')
  const block = `${BEGIN}\n${body}\n${END}\n`
  const kept = (hasBlock ? current.replace(managed, block) : outside).trimEnd()
  const next = hasBlock ? `${kept}\n` : (kept ? `${kept}\n\n${block}` : block)
  if (next === current) return
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, next)
}
