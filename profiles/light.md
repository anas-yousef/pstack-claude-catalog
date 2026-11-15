# pstack model configuration

Profile: light. For light features (docs, small fixes, copy, config, UI with no new data model). Opus keeps the main session, planning and key decisions; Sonnet does implementation, exploration, investigation and in-run review. No Haiku. Main session is Opus at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<config>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: opus @high
feature, refactoring: sonnet @high
bug-fix: sonnet @xhigh
perf-issue: sonnet @xhigh
hillclimb: sonnet @high
judgment and prose: opus @high
strongest judgment: opus @high
how explorer: sonnet @high
how explainer: sonnet @high
why investigators: sonnet @high
why synthesizer: opus @high
reflect tooling: sonnet @high
reflect judgment, divergent, synthesizer: sonnet @high
arena runners: sonnet @high, sonnet @high
arena cross-judge pool: opus @high, sonnet @high
swarm workers: sonnet @high
architect runners: opus @high, sonnet @high
interrogate reviewers: sonnet @high, sonnet @high
thermos reviewers: sonnet @high
no-comments reviewer: sonnet @high

default effort: high
panel vendors: any
