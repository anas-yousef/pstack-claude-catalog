---
name: committed-browser-proof
description: Use when claiming a browser or UI product is done, or when reviewing a verify skill that only has one-shot drive scripts.
---

# Committed browser proof

Claim a browser or UI product is done only after the committed project verify skill has driven the user path. A later run has to repeat that drive from the repo.

A script under `/tmp` can probe the app while you learn the selectors. Cite the committed skill. That file is not in the repo, so a reviewer cannot rerun it.

## Find the skill

Use `.claude/skills/verify/`. When the repo already maintains an older `.claude/skills/verify-<name>/`, use that directory. Leave it as the only verify skill.

When no verify skill exists, generate `.claude/skills/verify/` with `/create-verification-skill`. Keep the journey in that skill.

## Run the committed skill

Run that skill's launch and drive for the journey you changed. Keep the evidence the skill names. Cite that run when you claim the product is done or open the pull request.

Copy the working drive from a `/tmp` probe into the committed skill before you cite it. `/maintain-verification-skill` keeps the feature map honest after the app changes.

## Review a verify skill

Treat the skill as incomplete when its only browser proof is a one-shot drive script under `/tmp`, or when it tells the next agent to write that script and stop. A complete skill launches the app, drives the user path, and leaves evidence a later run can repeat from the repo.
