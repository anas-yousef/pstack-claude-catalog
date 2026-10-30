---
name: build-auto
description: poteto-mode invokes this skill for a product or a large feature. Use when poteto-mode starts a product or a large feature, when the user runs /build, or when /build auto should carry that work. poteto-mode takes review and ship when this skill returns.
---

# Build auto

poteto-mode is the single entry point. For a product or a large feature, poteto-mode invokes this skill. `/spec` and `/build` call the same skills. When the last selected task is committed, return to poteto-mode. poteto-mode owns review and ship.

## When to use

Use this skill for a product or a large feature, and when the user runs `/build` or `/build auto`.

A one-line fix stays on poteto-mode's bug-fix playbook.

When the product starts from an old repo, follow `../greenfield/SKILL.md` before this skill.

## Roles

The implementer uses the `feature, refactoring` role. The reviewer uses the `judgment and prose` role. Resolve both from the pstack model sheet. Do not add role lines under `plugins/pstack`.

Use the first matching line, in this order.

1. The project sheet the runtime already loads. On Claude Code that is `.claude/pstack-models.md` when `CLAUDE.md` includes it. On Codex that is `$CODEX_HOME/pstack-models.md`, or `~/.codex/pstack-models.md` when `CODEX_HOME` is unset. A file copied from `profiles/` is a project sheet.
2. The Models section of `plugins/pstack/skills/poteto-mode/SKILL.md`. Those defaults are stamped from `plugins/pstack/models.json`.

On Claude Code, pass the Claude family name as `model` on the `Agent` call. Pass an `@level` suffix as `effort`. `inherit-parent` and `auto` omit `model`.

On Codex, read Model names in `plugins/pstack/skills/poteto-mode/references/codex-tools.md` and the `codex` object in `plugins/pstack/models.json`. The `feature, refactoring` role uses the worker tier. The `judgment and prose` role uses the default tier. Pass that Codex slug to `spawn_agent`. Pass an `@level` suffix as `reasoning_effort`. Do not pass a Claude family name on Codex.

The implementer writes the task. The reviewer is a fresh subagent that checks the diff against the task's acceptance criteria before the commit. If no fresh reviewer can run, the tests still gate the commit. Report the missing reviewer to poteto-mode. The implementer's own read is not the review. Shipping stays with poteto-mode.

## Workflow

1. Write or reuse the spec. Follow `../spec-driven-development/SKILL.md`. A spec counts when it is `SPEC.md`, `docs/SPEC.md`, or a file under `spec/`.
2. Write or reuse the plan. Follow `../planning-and-task-breakdown/SKILL.md`. When the run is autonomous, approve the plan and continue. Autonomous means `/build auto`, a poteto-mode autonomy grant, or an explicit request to run until done. Otherwise show the plan and wait for an unambiguous yes. When this run created the plan, commit the plan alone before the first task commit.
3. Take the selected tasks in dependency order. `/build` with no argument selects the next pending task and stops after it. `/build auto`, and a poteto-mode run for a product or a large feature, selects every pending task.
4. For each selected task, the implementer follows `../incremental-implementation/SKILL.md` and `../../../pstack/skills/tdd/SKILL.md`.
5. Run the repository's unit tests and integration tests for the task. Both have to pass.
6. When the task changes a browser UI, run a committed browser end-to-end test and require it to pass. A change is user-visible when a person can see it in a browser UI. Use the repository's Playwright command, such as `test:e2e`, when the repository has one. Follow `../committed-browser-proof/SKILL.md`. A script that exists only under `/tmp` does not meet this gate. Copy a probe into the committed test before citing the run.
7. The reviewer checks the task against its acceptance criteria. Make one commit for that task. Stage the files the task touched, including its tests and its task-status update.
8. Return to poteto-mode for review and ship.

## Stop

Stop and return to the user when a test stays red, the spec does not cover a decision, or the task is irreversible. Irreversible work includes auth, payments, deletion, a deploy, or secrets. For a red test, follow `../systematic-debugging/SKILL.md`. For irreversible work, follow `../doubt-driven-development/SKILL.md` and wait for sign-off.

## Rationalizations

| Rationalization | Reality |
| --- | --- |
| "The UI change is small enough to skip the browser test" | A user-visible change is done only after the committed browser test passes. |
| "The /tmp script already proved it" | A script under `/tmp` is not in the repo, so the next run cannot repeat it. |
| "Commit the tasks together at the end" | Each task gets its own commit after its tests pass. |

## Verification

- The spec and the plan are in the repo.
- Each selected task has one commit.
- Unit tests and integration tests passed for each task.
- Each browser UI task has a committed end-to-end test that passed.
- Review and ship stayed with poteto-mode.
