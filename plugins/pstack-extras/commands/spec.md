---
description: Write a specification with spec-driven-development. poteto-mode stays the entry point.
disable-model-invocation: true
---

poteto-mode is the single entry point. For a product or a large feature, poteto-mode invokes `build-auto`, which runs the spec step itself. When the product starts from an old repo, follow the `greenfield` skill before this command.

Invoke the `spec-driven-development` skill and follow it. Save the spec as `SPEC.md`, `docs/SPEC.md`, or a file under `spec/`. Stop when the spec is saved. Implementation belongs to `build-auto`.
