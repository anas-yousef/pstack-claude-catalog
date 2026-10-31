# pstack model configuration

Profile: max. Opus and Fable for judgment and code, Sonnet only as a third panel seat. Xhigh effort by default, max where a role hunts an unknown cause, judges, or designs; exploration and workers stay at high. Main session is Sonnet at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<config>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: sonnet @high
feature, refactoring: opus @xhigh
bug-fix: opus @max
perf-issue: opus @max
hillclimb: opus @xhigh
judgment and prose: opus @xhigh
strongest judgment: fable @max
how explorer: opus @high
how explainer: opus @xhigh
why investigators: opus @xhigh
why synthesizer: fable @xhigh
reflect tooling: opus @high
reflect judgment, divergent, synthesizer: fable @xhigh
arena runners: opus @xhigh, fable @xhigh, sonnet @xhigh
arena cross-judge pool: fable @max, opus @max
swarm workers: opus @high
architect runners: fable @max, opus @xhigh
interrogate reviewers: fable @xhigh, opus @xhigh, sonnet @high

default effort: xhigh
