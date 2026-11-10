# pstack model configuration

Profile: fable-max. opus-max with Fable on design, judgment, and implementation: judgment and prose, strongest judgment, the first architect runner seat, feature and refactoring, bug-fix, and perf-issue. Reviews and every other role match opus-max. The Agent tool accepts only the family name `fable`, so pin it to Fable 5.2 by running Claude Code with `ANTHROPIC_DEFAULT_FABLE_MODEL=claude-fable-5-2`; without it, `fable` runs the CLI's default Fable model. Main session is Opus at xhigh.

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. This project sheet takes precedence over `<config>/pstack-models.md`. Where a skill names that path, use the lines here. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out. A model carries a reasoning effort, as in `opus @xhigh` (levels: low, medium, high, xhigh, max); the role's subagent then runs at that level, each entry of a panel list on its own. `default effort` sets the level for a value without one.

main session: opus @xhigh
feature, refactoring: fable @xhigh
bug-fix: fable @max
perf-issue: fable @max
hillclimb: opus @xhigh
judgment and prose: fable @xhigh
strongest judgment: fable @max
how explorer: opus @xhigh
how explainer: opus @xhigh
why investigators: opus @xhigh
why synthesizer: opus @max
reflect tooling: opus @xhigh
reflect judgment, divergent, synthesizer: opus @xhigh
arena runners: opus @xhigh, sonnet @xhigh
arena cross-judge pool: opus @xhigh, sonnet @xhigh
swarm workers: opus @xhigh
architect runners: fable @xhigh, sonnet @xhigh
interrogate reviewers: opus @xhigh, sonnet @xhigh
thermos reviewers: opus @xhigh
no-comments reviewer: opus @xhigh

default effort: xhigh
