# pstack model configuration

Profile: codex-balanced. Sol does feature work, exploration, and worker calls. Astra does bug-fix, perf, and judgment at high, and at xhigh where a role hunts an unknown cause or judges. Terra is the third seat on the arena and interrogate panels. Main session is Sol at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Copy this sheet to `<codex-home>/pstack-models.md`. Paste the model rows, the `default effort` line, and the minimum-effort line into `<codex-home>/AGENTS.md`. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `gpt-6-astra @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: gpt-6.1-sol @high
feature, refactoring: gpt-6.1-sol @high
bug-fix: gpt-6-astra @xhigh
perf-issue: gpt-6-astra @xhigh
hillclimb: gpt-6-astra @high
judgment and prose: gpt-6-astra @high
strongest judgment: gpt-6-astra @xhigh
how explorer: gpt-6.1-sol @high
how explainer: gpt-6-astra @high
why investigators: gpt-6-astra @high
why synthesizer: gpt-6-astra @xhigh
reflect tooling: gpt-6.1-sol @high
reflect judgment, divergent, synthesizer: gpt-6-astra @high
arena runners: gpt-6-astra @high, gpt-6.1-sol @high, gpt-6.1-terra @high
arena cross-judge pool: gpt-6-astra @xhigh, gpt-6.1-sol @high, gpt-6.1-terra @high
swarm workers: gpt-6.1-sol @high
architect runners: gpt-6-astra @xhigh, gpt-6.1-sol @high
interrogate reviewers: gpt-6-astra @xhigh, gpt-6.1-sol @high, gpt-6.1-terra @high

default effort: high
The effort listed for a role is a minimum, and subagents and the main session must not run below it.
panel vendors: any
