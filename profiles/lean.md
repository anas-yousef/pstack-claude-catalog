# pstack model configuration

Profile: lean. Sonnet and Haiku for every role but the strongest judgment, which gets Opus. Haiku reads files at medium effort; Sonnet works at high, and at xhigh where a role hunts an unknown cause. Main session is Sonnet at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<config>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: sonnet @high
feature, refactoring: sonnet @high
bug-fix: sonnet @xhigh
perf-issue: sonnet @xhigh
hillclimb: sonnet @high
judgment and prose: sonnet @high
strongest judgment: opus @high
how explorer: haiku @medium
how explainer: sonnet @high
why investigators: haiku @high
why synthesizer: sonnet @high
reflect tooling: haiku @medium
reflect judgment, divergent, synthesizer: sonnet @high
arena runners: sonnet @high, haiku @high
arena cross-judge pool: opus @high, sonnet @high
swarm workers: haiku @high
architect runners: sonnet @xhigh, haiku @high
interrogate reviewers: sonnet @high, haiku @high

default effort: medium
