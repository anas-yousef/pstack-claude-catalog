# pstack-claude-catalog

A pinned Claude Code plugin marketplace. It holds [pstack-claude](https://github.com/michael-denyer/pstack-claude) as upstream ships it, plus the extra skills [pstack-grok](https://github.com/anas-yousef/pstack-grok) vendors for Cursor. Model choice is the pstack-claude port's. This repo sets none.

## Plugins

- **`pstack`** (`plugins/pstack/`). The pstack-claude plugin, byte for byte. It provides `/pstack:poteto-mode`, the `pstack:poteto-agent` and `pstack:comment-sicko` agents, the principles, and the session hook.
- **`pstack-extras`** (`plugins/pstack-extras/`). Skills that pstack-claude does not ship:
  - from cursor-team-kit: `check-compiler-errors`, `control-cli`, `control-ui`, `loop-on-ci`, `new-branch-and-pr`, `pr-review-canvas`, `review-and-ship`, `run-smoke-tests`, `verify-this`, `weekly-review`, and `workflow-from-chats`
  - from superpowers: `verification-before-completion`, `systematic-debugging`, and `receiving-code-review`
  - from mattpocock/skills: `domain-modeling`, `writing-for-agents`, and `wizard`

Original lean skills may live in `pstack-extras` for Cursor and Claude alignment when `plugins/pstack/` must stay byte for byte with pstack-claude. `committed-browser-proof` is one, and its directory is on the `ORIGINAL` list in `tools/sync.mjs` so the next sync keeps it.

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

## Update

`node tools/sync.mjs --check` compares each pin in `sources.json` with the default branch of that remote. `--outdated` is the same check. The command prints one line per source and leaves every file in the tree unchanged. Exit 0 means every mapped path matches its pin, including when the branch tip has commits that leave those paths alone. The process exits 1 when a mapped path differs, which is the signal to bump that pin. It also exits 1 when it cannot read a remote.

1. Edit a commit in `sources.json`.
2. Run `node tools/sync.mjs`. Pass `--from <name>=<checkout>` to use a clean local checkout at that commit instead of fetching.
3. Review the diff, update the commit and file lists in `NOTICE`, and commit.

A second run with the same pins writes the same bytes. A project picks up the change when its pin moves to the new commit.

## License

Original work is MIT, see `LICENSE`. Vendored work keeps its own MIT license, see `NOTICE`.
