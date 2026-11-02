# pstack-claude-catalog

A pinned Claude Code and Codex plugin marketplace. `plugins/pstack/` is [pstack-claude](https://github.com/michael-denyer/pstack-claude), byte for byte. `plugins/pstack-extras/` adds skills and playbooks. `NOTICE` lists sources, licenses, and local changes; `sources.json` pins upstream commits.

## Setup

Run inside your project:

```sh
curl -fsSL https://raw.githubusercontent.com/anas-yousef/pstack-claude-catalog/main/tools/init.mjs | node -
```

Requires Node.js and Git. Install Claude Code and, if you use Codex, a Codex CLI with `codex plugin` support. Init checks CLI availability before writing project files. When Codex is absent, it prints a message and skips Codex files, trust, and plugin commands; Claude setup still completes. If Claude is absent, its settings and model sheet are prepared, and a message asks you to install Claude and rerun init for plugin installation.

Init registers the Claude marketplace from its [GitHub slug](https://code.claude.com/docs/en/plugins/host-marketplace#register-the-marketplace-for-everyone-in-a-repository) and runs `claude plugin install <plugin>@pstack-claude-catalog --scope project` for each plugin. If [user settings declare another source](https://code.claude.com/docs/en/settings-reference#extraknownmarketplaces), init registers the marketplace from that source, leaves that entry unchanged, and restores the file bytes after registration; a managed settings conflict is reported. For Codex, it configures the pinned marketplace, runs `codex plugin marketplace upgrade`, and explicitly installs each plugin with `codex plugin add`. These are headless commands from the official [Claude plugin reference](https://code.claude.com/docs/en/plugins/cli-reference) and [Codex developer-command reference](https://learn.chatgpt.com/docs/developer-commands#codex-plugin). A Claude install failure still allows Codex setup, including [project trust](https://learn.chatgpt.com/docs/config-file/config-reference), to complete before reporting the error and exiting nonzero; rerunning retries installation.

Init installs separate Claude and Codex model sheets and sets each runtime's main session model. An existing independent `CLAUDE.md` imports `.claude/pstack-models.md`; `AGENTS.md` points Codex to `.codex/pstack-models.md`. When `CLAUDE.md` is absent or shares `AGENTS.md` through a symlink, `AGENTS.md` also keeps the Claude include exactly once. Init preserves the symlink and creates no missing `CLAUDE.md`. Existing project prose and unrelated settings stay.

Permissions default to bypass, independently of the model profile:

- `~/.claude/settings.json`: `permissions.defaultMode = "bypassPermissions"` (or `$CLAUDE_CONFIG_DIR/settings.json`). This user setting applies to every project on the machine. Claude [ignores bypass mode in project settings](https://code.claude.com/docs/en/settings#a-value-you-set-is-ignored), so init removes that obsolete project value. It also removes a project `defaultMode = "default"` during bypass setup: project settings have higher precedence and otherwise mask the user bypass. Explicit project modes such as `plan` remain intentional overrides.
- `.codex/config.toml`: `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`.

Pass `--ask-permissions` to remove these bypass values from a previous init, including Claude's user setting. Other permission modes, allow/deny rules, and settings stay; `--ask-permissions` also preserves a project `default` mode. For example, append `--ask-permissions` after `node -` in the command above. Pass it on each init run that should use normal permission prompts.

Init trusts this project in `~/.claude.json` and, when Codex is installed, `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) so the runtimes load its project settings on their first headless session. Per [Claude workspace trust](https://code.claude.com/docs/en/permissions#project-allow-rules-and-workspace-trust), init sets `projects["<repo-root>"].hasTrustDialogAccepted = true`; linked worktrees use the main checkout’s root. Codex trust uses the consumer checkout’s path, and its project `approval_policy` and `sandbox_mode` apply before `codex exec` starts ([configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence), [sandbox and approvals](https://learn.chatgpt.com/docs/agent-approvals-security)). Claude plugins follow catalog main; Codex plugins use the commit recorded in `.claude/pstack-claude-pin.json`, through the documented [`marketplaces.<name>.ref` setting](https://learn.chatgpt.com/docs/config-file/config-reference).

Run the same command again to refresh. It keeps the selected profiles unless you pass profile flags. It installs `scripts/pstack-claude-check.mjs`, its two libraries, and a compatibility shim at `scripts/check-pstack.mjs` for existing CI and hooks. A foreign file at the legacy path stays untouched. Both checker commands keep their Bash allow rules. The command compares the installed pin with catalog main: `current` exits 0, `outdated` exits 1, and `offline` exits 0. It writes nothing. Pins written without a Codex profile default to `codex-balanced`; reading a missing or malformed profile fails.

Script ownership uses exact SHA-256 hashes. `scripts/lib/owned.json` records shipped hashes and known historical versions with their source commits. Init records installed hashes in `.claude/pstack-claude-owned.json`; an upgrade accepts those exact bytes or a known release's hash. Edited or foreign files at required destinations stop init before any script is overwritten. To change a managed script in this catalog, retain its old hash under `previous`, update `sha256`, and run the manifest test.

## Authentication and first-session proof

Init installs configuration and plugins; it does not log you in. Authenticate before the first headless session:

- Claude: run `claude auth login` (or launch `claude` and sign in) in the HOME you will use, then check `claude auth status`. [Claude’s auth docs](https://code.claude.com/docs/en/authentication#log-in-to-claude-code) describe this flow. Linux credentials live at `~/.claude/.credentials.json` (mode `0600`), or under `CLAUDE_CONFIG_DIR`; changing HOME does not carry your login with it.
- Codex: supply `OPENAI_API_KEY` and run `printenv OPENAI_API_KEY | codex login --with-api-key` with shell tracing off, or run `codex login` for ChatGPT sign-in. Check `codex login status`. The [official auth docs](https://learn.chatgpt.com/docs/auth#sign-in-with-an-api-key) also describe [copying the auth cache](https://learn.chatgpt.com/docs/auth#fallback-authenticate-locally-and-copy-your-auth-cache) to a headless environment. Treat `auth.json` as a password.

Run `node tools/headless.mjs` with authenticated Linux Claude/Codex caches and `OPENAI_API_KEY` present. This opt-in test uses fresh temporary Git consumers and HOME directories, copies only credential files without displaying them, runs init once, then runs real `claude -p` and `codex exec` sessions with no permission flags. It checks actual checker tool output against the real remote, writes a unique file outside each repo, and reads Codex’s recorded sandbox/approval/model/effort. It covers a normal checkout, a project with an ordinary `default` permission mode, a linked worktree, and a separate API-key login HOME. The API-key case requires available API quota as well as valid authentication: a `Quota exceeded` inference response fails the proof even when login succeeded. Credentials and caches are deleted in `finally`; raw session stdout/stderr remains at the printed path. Any warning or permission denial fails the proof. Plugin installation uses a Git snapshot of the candidate catalog via the existing local-catalog test seam; the checker’s network request is not mocked. The temporary HOME defaults beneath the caller’s home because Codex rejects helper aliases under the OS temp directory; `PSTACK_PROOF_ROOT` can select another parent outside that directory.

## Model profiles

Pass `--profile <name>` to select a Claude sheet and its matching `codex-<name>` sheet. `--codex-profile <name>` selects the Codex sheet separately. `max` falls back to `codex-balanced`. `--commit <40-digit-sha>` selects a catalog commit.

Each role row names a model and effort, such as `sonnet @high`. The separate `main session` row controls the session model and effort. Without an installed sheet, skills use their plugin defaults. The files in `profiles/` hold the complete role lists; every profile must cover every role.

| Claude profile | Mix | Main session |
| --- | --- | --- |
| `balanced` | Opus for most roles, Sonnet for feature work and workers, Fable for strongest judgment. | Sonnet at `high` |
| `design-heavy` | Opus at `high` for design and judgment; Sonnet for feature work and workers. | Sonnet at `high` |
| `design-heavy-extra` | `design-heavy` with the Opus design seats at `xhigh`. | Opus at `high` |
| `lean` | Sonnet and Haiku, with Opus for strongest judgment. | Sonnet at `high` |
| `max` | Opus and Fable at `xhigh`, or `max` for the hardest roles. | Sonnet at `high` |

| Codex profile | Mix | Main session |
| --- | --- | --- |
| `codex-balanced` | Sol for feature work and workers; Astra for bugs and judgment; Terra on panels. | Sol at `high` |
| `codex-design-heavy` | Astra at `high` for design and judgment; Sol for feature work and workers. | Sol at `high` |
| `codex-design-heavy-extra` | `codex-design-heavy` with the Astra design seats at `xhigh`. | Astra at `high` |
| `codex-lean` | Sol for most roles; Astra for bugs and strongest judgment; Sol, Terra, and Luna on panels. | Sol at `high` |

A PRD or spec uses `judgment and prose`. Codex sheets set `panel vendors: any`. Each subagent role effort is a minimum only for subagents assigned that role. Only `main session` sets the main session model and effort during init; a bug-fix row at `@xhigh` does not raise a main session at `@high`. The actual session effort comes from [`model_reasoning_effort`](https://learn.chatgpt.com/docs/config-file/config-reference#model_reasoning_effort), subject to explicit user overrides; prose cannot reconfigure a running session. Each installed sheet lists available profiles and a chat override: say `Use <profile> for this chat` to load that profile from the pinned catalog for the chat.

## Use

Start with `/pstack:poteto-mode`. Products and large features use `build-auto`; a rebuild of an existing repo starts with `greenfield`. Claude also has `/critique`, `/prd`, `/merge-reviews`, `/spec`, and `/build`; Codex loads the corresponding skills. `/build auto` approves the plan and runs pending tasks.

## Maintain the catalog

```sh
node --test tools/*.test.mjs # includes real Claude/Codex first-run checks in temporary homes
node tools/sync.mjs --check
```

`--check` (also `--outdated`) compares pinned upstream paths with each remote's default branch and writes nothing. Exit 0 means mapped paths have not changed; exit 1 means a mapped path changed or a remote could not be read.

To refresh upstream content:

1. Edit the commit in `sources.json`.
2. Run `node tools/sync.mjs`. Use `--from <name>=<checkout>` to read a local checkout at the pin.
3. Reapply the agent-skills substitutions listed in `NOTICE`, review the diff, update `NOTICE`, and commit.

The sync tool preserves original extras and setup files. `plugins/pstack/` must remain identical to its upstream pin. In the Vercel extras skill, `sources.json` maps upstream `AGENTS.md` to `REFERENCE.md`; update its SKILL link after syncing, so the compiled guide stays an on-demand reference ([Cursor nested instruction rules](https://cursor.com/docs/rules#nested-agentsmd-support)).

## Thanks and license

[Lauren Tan](https://github.com/cursor/plugins/tree/main/pstack) wrote pstack; [Michael Denyer](https://github.com/michael-denyer/pstack-claude) ported it to Claude Code. Additional skills come from Cursor, Jesse Vincent, Matt Pocock, Addy Osmani, Vercel Labs, and Supabase.

Original work is MIT (`LICENSE`). Vendored work keeps its own MIT license; see `NOTICE`.
