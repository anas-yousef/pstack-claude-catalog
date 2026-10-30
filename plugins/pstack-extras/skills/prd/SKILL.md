---
name: prd
description: Interview for a product requirements document and write it. Use when the user asks for a PRD, a product brief, or a grill before a feature spec. Writes docs/prd/<feature>.md and then hands off to spec-driven-development.
---

# PRD

The interview is `../grilling/SKILL.md`. Follow that skill. Do not restate it.

Grill these branches. Ask a branch only when its prerequisites are settled.

- Users. Who is served, and who is not.
- Problems. What fails for them today.
- Outcomes. What is true when this ships.
- Non-goals. What this effort will not do.
- Acceptance. The checks that show each outcome.
- Open questions. Decisions that stay unresolved.

When the user confirms a shared understanding, write `docs/prd/<feature>.md`. `<feature>` is the kebab-case name they gave. When they gave none, take it from the outcome. One file per feature.

Use these sections.

- Users
- Problems
- Outcomes
- Non-goals
- Acceptance
- Open questions

Each section records the settled answers. Keep unresolved items under Open questions.

Then follow `../spec-driven-development/SKILL.md`. The PRD is the settled input. Interview only an open question that the spec still needs. Save the spec as `SPEC.md`, `docs/SPEC.md`, or a file under `spec/`. Stop when the spec is saved. Implementation belongs to `build-auto`.
