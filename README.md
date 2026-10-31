# pstack-claude-catalog

A pinned Claude Code plugin marketplace. It holds [pstack-claude](https://github.com/michael-denyer/pstack-claude) as upstream ships it, plus the extra skills [pstack-grok](https://github.com/anas-yousef/pstack-grok) vendors for Cursor. The plugins keep the pstack-claude model defaults. `profiles/` holds optional per-role model mixes.

## Plugins

- **`pstack`** (`plugins/pstack/`). The pstack-claude plugin, byte for byte. It provides `/pstack:poteto-mode`, the `pstack:poteto-agent` and `pstack:comment-sicko` agents, the principles, and the session hook.
- **`pstack-extras`** (`plugins/pstack-extras/`). Skills that pstack-claude does not ship:
  - from cursor-team-kit: `check-compiler-errors`, `control-cli`, `control-ui`, `loop-on-ci`, `new-branch-and-pr`, `review-and-ship`, `run-smoke-tests`, and `verify-this`
  - from superpowers: `verification-before-completion`, `systematic-debugging`, and `receiving-code-review`
  - from mattpocock/skills: `domain-modeling`, `writing-for-agents`, `wizard`, and `grilling`
  - from addyosmani/agent-skills: `spec-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `documentation-and-adrs`, `shipping-and-launch`, `doubt-driven-development`, `performance-optimization`, `frontend-ui-engineering`, and `browser-testing-with-devtools`, plus `references/performance-checklist.md` and `references/accessibility-checklist.md`
  - from vercel-labs/agent-skills: `vercel-react-best-practices`
  - from supabase/agent-skills: `supabase` and `supabase-postgres-best-practices`

Original lean skills may live in `pstack-extras` for Cursor and Claude alignment when `plugins/pstack/` must stay byte for byte with pstack-claude. `committed-browser-proof`, `local-supabase`, `build-auto`, `legacy-critique`, `prd`, `merge-reviews`, and `greenfield` are on the `ORIGINAL` list in `tools/sync.mjs`, along with `plugins/pstack-extras/commands/` and `plugins/pstack-extras/.codex-plugin/`, so the next sync keeps them. For a greenfield product that needs a database, auth, or row-level security, use `local-supabase`.

poteto-mode is the single entry point. For a product or a large feature, poteto-mode invokes `build-auto`. A product that starts from an old repo follows `greenfield` first. That skill runs `legacy-critique`, then `merge-reviews`, then `prd`, then `build-auto`. `/critique`, `/prd`, `/merge-reviews`, `/spec`, and `/build` are the Claude commands. Codex loads the skills. The commands are the Claude wrappers. `/build auto` approves the plan and runs every pending task.

`NOTICE` lists each source, its license, and what is left out. `sources.json` pins the upstream commits.

## Use it from a project

Pin one commit of this repo in the project. Then clone that commit onto the machine and install the plugins from the clone:

```sh
git clone https://github.com/anas-yousef/pstack-claude-catalog ~/.claude/plugins/marketplaces/pstack-claude-catalog
git -C ~/.claude/plugins/marketplaces/pstack-claude-catalog checkout --detach <commit>
claude plugin marketplace add ~/.claude/plugins/marketplaces/pstack-claude-catalog
claude plugin install pstack@pstack-claude-catalog
claude plugin install pstack-extras@pstack-claude-catalog
```

Do not also enable `pstack@pstack-claude` in the same project. Both plugins are named `pstack`, so they share the `pstack:` namespace, and Claude Code leaves out one of their hooks.

Codex consumers register this repo as a marketplace, then enable both plugins with `codex plugin add`. From the checkout root:

```sh
codex plugin marketplace add .
codex plugin add pstack@pstack-claude-catalog
codex plugin add pstack-extras@pstack-claude-catalog
```

From GitHub, use the same plugin names:

```sh
codex plugin marketplace add anas-yousef/pstack-claude-catalog
codex plugin add pstack@pstack-claude-catalog
codex plugin add pstack-extras@pstack-claude-catalog
```

Codex reads `plugins/pstack/.codex-plugin/plugin.json` and `plugins/pstack-extras/.codex-plugin/plugin.json`. It loads each plugin's `skills/` directory. `pstack-extras` ships no Codex hooks.

## Model profiles

pstack-claude reads its per-role models from a `pstack-models.md` sheet. With no sheet, every role runs on the defaults that `plugins/pstack/models.json` stamps into each skill. `profiles/` holds complete sheets with other mixes. Each role line names a model family and its own reasoning effort, as in `sonnet @high`, so two roles on the same model can run at different levels. Reasoning effort is how long the model thinks before it answers. A lower level spends fewer tokens per call.

| Profile | Mix |
| --- | --- |
| `balanced` | Opus for most roles, Sonnet for feature work and workers, Fable for the strongest judgment. `high` by default, `xhigh` for bug-fix, perf-issue, the why synthesizer, and judges. |
| `lean` | Sonnet and Haiku, with Opus only for the strongest judgment. Haiku explores at `medium`. Sonnet works at `high`, and at `xhigh` for bug-fix and perf-issue. |
| `max` | Opus and Fable at `xhigh`, and at `max` for bug-fix, perf-issue, the strongest judgment, judges, and design. Exploration and workers stay at `high`. |

To use a Claude profile in a project, copy it to `.claude/pstack-models.md` and add this line to the project's `CLAUDE.md`:

```text
@.claude/pstack-models.md
```

The sheet states that it takes precedence over `<config>/pstack-models.md`, which `/setup-pstack` writes. `balanced`, `lean`, and `max` pass `plugins/pstack/skills/setup-pstack/scripts/check-sheet.sh`. To add a Claude mix, add one file to `profiles/` with every role line and a `Profile:` line, and run that check on it. `tools/sync.mjs` never writes or deletes `profiles/`.

### Codex profiles

`profiles/codex-balanced.md` and `profiles/codex-lean.md` are Codex sheets. Codex installs a profile as `<codex-home>/pstack-models.md`. Paste the model rows and the `default effort` line into `<codex-home>/AGENTS.md`.

| Profile | Mix |
| --- | --- |
| `codex-balanced` | Sol for feature work, exploration, and workers. Astra for bug-fix, perf, and judgment, at `high`, and at `xhigh` where a role hunts an unknown cause or judges. Terra is the third seat on the arena and interrogate panels. |
| `codex-lean` | Sol at `high` for each single-model role other than bug-fix, perf-issue, and the strongest judgment, which use Astra at `high`. Panels use Sol, Terra, and Luna. |

Both sheets include `panel vendors: any`, because every Codex slug shares a `gpt-` prefix. setup-pstack pastes the model rows and the `default effort` line into `<codex-home>/AGENTS.md`. `panel vendors: any` is outside that paste, so it stays in the sheet. Every profile must cover every role. This README is the only place that rule is recorded.

## Update

`node tools/sync.mjs --check` compares each pin in `sources.json` with the default branch of that remote. `--outdated` is the same check. The command prints one line per source and leaves every file in the tree unchanged. Exit 0 means every mapped path matches its pin, including when the branch tip has commits that leave those paths alone. The process exits 1 when a mapped path differs, which is the signal to bump that pin. It also exits 1 when it cannot read a remote.

1. Edit a commit in `sources.json`.
2. Run `node tools/sync.mjs`. Pass `--from <name>=<checkout>` to use a clean local checkout at that commit instead of fetching.
3. Review the diff, update the commit and file lists in `NOTICE`, and commit.

The agent-skills pin has a local patch recorded under Changes in `NOTICE`. `node tools/sync.mjs` restores the upstream sentences for that source. Reapply those substitutions before committing a refresh.

A second sync with the same pins writes the same upstream bytes. A project picks up the catalog change when its pin moves to the new commit.

## License

Original work is MIT, see `LICENSE`. Vendored work keeps its own MIT license, see `NOTICE`.
