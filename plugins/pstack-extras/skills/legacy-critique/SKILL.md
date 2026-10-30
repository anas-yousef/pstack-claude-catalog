---
name: legacy-critique
description: Read-only review of an old repository before a rewrite. Use when the user asks for a legacy critique, a read of an old repo, or what to keep from a prior codebase. Writes docs/reviews/<harness>/legacy-critique.md and does not edit the old repo.
---

# Legacy critique

Read the old repo. Write one critique in the destination repo. Leave the old repo unchanged.

## Read

Follow `../../../pstack/skills/how/SKILL.md` for how the system runs. Follow `../../../pstack/skills/why/SKILL.md` for why it has that shape. Use their reports. Do not edit files during the read.

The old repo is the tree the user named. When they named none, use the checkout they asked you to critique.

When the runtime cannot spawn the subagents those skills name, do the read in this session and keep their output sections.

## Harness

`<harness>` is `claude`, `codex`, or `grok`.

- Use `claude` when this session is Claude Code.
- Use `codex` when this session is Codex.
- Use `grok` when this session is Grok.
- Ask the human to pick one of those three when the session is none of them, or when you cannot tell.

## Write

The destination repo is the repo that will hold the new product. Create `docs/reviews/<harness>/legacy-critique.md` there.

When that path would land inside the old repo, ask for a different destination and write there. Do not create, stage, or commit any file in the old repo.

Record the old repo path and the commit you read, when git can resolve one.

Use these sections, in this order.

- Domain model
- Data shape
- Boundaries
- What worked
- Pain points
- Keep, drop, rework
- Risks

Keep, drop, and rework are three lists in that one section. Each item names the thing and a cite.

Every claim that points at code cites `path:line` or `path:start-end`, relative to the old repo root. Leave out a claim that has no cite.

## Stop

The critique file is the only write. Do not patch the old repo. Do not open a pull request against it.
