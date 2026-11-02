# pstack model configuration

Profile: codex-design-heavy-extra. Astra at xhigh for judgment and prose and for the strongest judgment. Architect runners, the arena cross-judge pool, and interrogate reviewers start with Astra at xhigh and keep the other seats from codex-balanced. Sol at high for feature work, refactoring, and swarm workers. Astra at high for bug-fix and perf-issue. Every other role matches codex-balanced. Terra stays the third seat on the arena and interrogate panels. Main session is Astra at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<codex-home>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `gpt-6-astra @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

For Codex `spawn_agent`, task names must use only lowercase letters, digits, and underscores; replace spaces and hyphens in role names with underscores (for example, `how explorer` becomes `how_explorer`).

main session: gpt-6-astra @high
feature, refactoring: gpt-6.1-sol @high
bug-fix: gpt-6-astra @high
perf-issue: gpt-6-astra @high
hillclimb: gpt-6-astra @high
judgment and prose: gpt-6-astra @xhigh
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
Each subagent role row sets the minimum effort only for subagents assigned to that role. The `main session` row alone sets the main session model and effort at initialization. For example, a bug-fix subagent at @xhigh does not raise a main session configured at @high. `default effort` applies only to a row without an explicit @level. Explicit user model or effort overrides take precedence; this sheet does not change an already running session’s settings.
panel vendors: any
