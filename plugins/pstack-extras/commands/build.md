---
description: Run build-auto for the next task. Pass auto to approve the plan and run every pending task.
disable-model-invocation: true
argument-hint: "[auto]"
---

poteto-mode is the single entry point. For a product or a large feature, poteto-mode invokes `build-auto`.

Invoke the `build-auto` skill and follow it.

`$ARGUMENTS` selects the tasks. `auto` approves the plan and runs every pending task. An empty argument runs the next pending task and then stops.
