---
name: merge-reviews
description: Merge harness critiques into decisions. Use when docs/reviews contains claude, codex, or grok reviews, or when the user asks to merge reviews. Agreements become ADRs. Each conflict becomes an open decision file other agents can extend.
---

# Merge reviews

Read every markdown file under `docs/reviews/claude/`, `docs/reviews/codex/`, and `docs/reviews/grok/`. A missing directory means that harness has not reviewed. Do not invent a position for it.

Also read `docs/decisions/*.md` and `docs/decisions/open/*.md`.

Follow `../documentation-and-adrs/SKILL.md` for the body of each ADR. Do not restate that template. Write the file at `docs/decisions/NNNN-<topic>.md`. When the repo already stores ADRs in another directory, name that directory in the ADR context and in the report. This flow still writes here, so later agents have one place to look.

Do not edit files under `docs/reviews/`.

## Topics

Take candidate decisions from each review's boundaries, keep, drop, rework, and risks. One decision is one choice about one thing, plus the cites that review gave.

- One harness only. Leave it. No ADR and no open file.
- Two or more harnesses, same choice, and none disagrees. Agreement.
- Two or more harnesses, different choices. Conflict.

`<topic>` is a short kebab-case slug. Reuse the existing ADR or open file when the slug names the same decision. When you are unsure they are the same, leave them separate and say so.

## Numbers

`NNNN` is four digits. Take one more than the highest number already used in `docs/decisions/` or `docs/decisions/open/`. Use `0001` when both are empty. When one run writes several files, allocate numbers in slug order.

## Agreements

Write an ADR for an agreement that does not already have one with the same decision. Cite the review files and the code cites those reviews used. Status is Accepted.

Skip a topic that already has that ADR.

## Conflicts

Write `docs/decisions/open/NNNN-<topic>.md` for a conflict that does not already have an open file.

```markdown
# <question>

Status: open

## Question

<one question a later round or the human can settle>

## Positions

### <harness>

<position>

<cites from that review>

## Round 1

<harness>: <position>. <cites>
```

Repeat the harness blocks for each harness that disagrees.

## Add a round

Append `## Round N` at the end. `N` is one more than the last round. Do not edit earlier rounds.

Under the new heading, record each harness that is writing, its position, and its cites. A human decision is the line `Human: <decision>`.

## Re-run

Run this skill again after a new review or a new round.

- Leave a file alone when its status line starts with `Status: resolved by `. A review that contradicts a resolved file stays in the report. Do not reopen the file.
- Append a round when a review's position on that open topic changed. Leave the file alone when it did not.
- When the human decides in this session, append a round that contains `Human: <decision>` before promoting.
- When the latest round contains a `Human:` line, that line is the decision. Write the ADR, then resolve the open file.
- When every harness that appears under Positions states the same choice in the latest round, that choice is the decision. Write the ADR, then resolve the open file.
- Resolve in place. Set the status line to `Status: resolved by docs/decisions/NNNN-<topic>.md`. Leave the rounds. Do not delete the file.
- A new agreement with no ADR gets an ADR.
- A new conflict with no open file gets an open file.

The ADR for a promoted conflict records the rejected positions as alternatives.

## Report

Tell the human which ADRs you wrote, which open files you resolved, and which open files remain. For each remaining file, give the question and the split in the latest round. A single-harness decision stays in this report and does not get a file. Nothing remains open when every file under `docs/decisions/open/` is resolved, or that directory is empty.
