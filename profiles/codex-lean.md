# pstack model configuration

Profile: codex-lean. Sol at high for each single-model role other than bug-fix, perf-issue, and the strongest judgment, which use Astra at high. Arena, architect, and interrogate panels use Sol, Terra, and Luna. Main session is Sol at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<codex-home>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `gpt-6-astra @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

For Codex `spawn_agent`, task names must use only lowercase letters, digits, and underscores; replace spaces and hyphens in role names with underscores (for example, `how explorer` becomes `how_explorer`).

main session: gpt-6.1-sol @high
feature, refactoring: gpt-6.1-sol @high
bug-fix: gpt-6-astra @high
perf-issue: gpt-6-astra @high
hillclimb: gpt-6.1-sol @high
judgment and prose: gpt-6.1-sol @high
strongest judgment: gpt-6-astra @high
how explorer: gpt-6.1-sol @high
how explainer: gpt-6.1-sol @high
why investigators: gpt-6.1-sol @high
why synthesizer: gpt-6.1-sol @high
reflect tooling: gpt-6.1-sol @high
reflect judgment, divergent, synthesizer: gpt-6.1-sol @high
arena runners: gpt-6.1-sol @high, gpt-6.1-terra @high, gpt-6-luna @high
arena cross-judge pool: gpt-6.1-sol @high, gpt-6.1-terra @high, gpt-6-luna @high
swarm workers: gpt-6.1-sol @high
architect runners: gpt-6.1-sol @high, gpt-6.1-terra @high, gpt-6-luna @high
interrogate reviewers: gpt-6.1-sol @high, gpt-6.1-terra @high, gpt-6-luna @high

default effort: high
Each subagent role row sets the minimum effort only for subagents assigned to that role. The `main session` row alone sets the main session model and effort at initialization. For example, a bug-fix subagent at @xhigh does not raise a main session configured at @high. `default effort` applies only to a row without an explicit @level. Explicit user model or effort overrides take precedence; this sheet does not change an already running session’s settings.
panel vendors: any
