# pstack model configuration

Profile: fable. opus with Fable at the opus effort on judgment and prose, strongest judgment, and the first architect runner seat. Implementation, reviews, and every other role match opus. The Agent tool accepts only the family name `fable`, so pin it to Fable 5.2 by running Claude Code with `ANTHROPIC_DEFAULT_FABLE_MODEL=claude-fable-5-2`; without it, `fable` runs the CLI's default Fable model. Main session is Opus at high.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<config>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: opus @high
feature, refactoring: sonnet @high
bug-fix: opus @xhigh
perf-issue: opus @xhigh
hillclimb: opus @high
judgment and prose: fable @high
strongest judgment: fable @xhigh
how explorer: sonnet @high
how explainer: opus @high
why investigators: opus @high
why synthesizer: opus @xhigh
reflect tooling: sonnet @high
reflect judgment, divergent, synthesizer: opus @high
arena runners: opus @high, sonnet @high
arena cross-judge pool: opus @high, sonnet @high
swarm workers: sonnet @high
architect runners: fable @high, sonnet @high
interrogate reviewers: opus @high, sonnet @high
thermos reviewers: opus @high
no-comments reviewer: opus @high

default effort: high
