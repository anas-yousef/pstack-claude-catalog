# pstack model configuration

Profile: design-heavy-extra. Opus at xhigh for judgment and prose and for the strongest judgment. Architect runners, the arena cross-judge pool, and interrogate reviewers start with Opus at xhigh and keep the other seats from balanced. Sonnet at high for feature work, refactoring, and swarm workers. Opus at high for bug-fix and perf-issue. Every other role matches balanced. Main session is Opus at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<config>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: opus @high
feature, refactoring: sonnet @high
bug-fix: opus @high
perf-issue: opus @high
hillclimb: opus @high
judgment and prose: opus @xhigh
strongest judgment: opus @xhigh
how explorer: sonnet @high
how explainer: opus @high
why investigators: opus @high
why synthesizer: opus @xhigh
reflect tooling: sonnet @high
reflect judgment, divergent, synthesizer: opus @high
arena runners: opus @high, fable @high, sonnet @high
arena cross-judge pool: opus @xhigh, fable @xhigh, sonnet @high
swarm workers: sonnet @high
architect runners: opus @xhigh, sonnet @high
interrogate reviewers: opus @xhigh, fable @high, sonnet @high

default effort: high
