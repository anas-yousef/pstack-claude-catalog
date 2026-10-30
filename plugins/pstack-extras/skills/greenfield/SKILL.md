---
name: greenfield
description: Route a new product that starts from an old repo. Use for a greenfield build, a rewrite, or when the work should pass through a legacy critique, merged reviews, a PRD, and build-auto.
---

# Greenfield

poteto-mode stays the entry point. This skill is the path a new product takes. `plugins/pstack` does not carry this playbook.

Follow each step's skill. Skip a step that has nothing to read.

1. Follow `../legacy-critique/SKILL.md` when an old repo is in scope. One critique per harness, at `docs/reviews/<harness>/legacy-critique.md`.
2. Follow `../merge-reviews/SKILL.md` when more than one harness has a review. Agreements become ADRs. Conflicts stay open for later rounds.
3. Follow `../prd/SKILL.md`. It writes `docs/prd/<feature>.md` and then a spec.
4. Follow `../build-auto/SKILL.md`. It implements the spec. Review and ship stay with poteto-mode.

A product with no old repo starts at step 3. One harness does not need step 2.
