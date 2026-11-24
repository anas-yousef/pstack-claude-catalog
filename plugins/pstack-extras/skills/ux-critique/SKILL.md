---
name: ux-critique
description: Render every screen a UI change touches at desktop and phone widths, in light and dark, in each locale including RTL, and have two fresh reviewers judge the screenshots per persona. Use whenever a change touches a browser UI, after a build or ship, when a UI pull request is reviewed (poteto-mode routes here), or when the user asks for a UX critique. Writes docs/ux-critique/<feature>.md and fixes nothing.
---

# UX critique

This pass sits on top of the e2e and integration tests. It does not replace them. Tests prove the UI works. This pass asks whether a person can use it.

This pass looks at rendered screens. A review that reads only the diff or the code is not a UX critique: a cramped button, text cut on the wrong side, or a row that is too tall shows only on a rendered screen.

The project supplies personas and locales. This skill names none.

## Flows

List 3 to 7 key flows. Give each a start state and a done state. Include at least one flow off the happy path: an error, an empty state, a denied permission, or a recovery. Add every screen and state the change touches: each changed route, page, or layout, and each screen that shows a changed shared component. This list is the QA inventory. Every later step uses it.

## Personas

Take personas from the project: `docs/personas/`, or a personas section in `AGENTS.md` or `CLAUDE.md`. When the project has none, use two, one line each: an end user and an operator or staff member.

## Capture

Render each flow and each touched screen in the running app. Drive it with the repo's own harness, or follow `../control-ui/SKILL.md`. Screenshot every step. A screen that was not rendered has not been critiqued.

Capture every touched screen and every flow step in each combination of:

- Desktop width, 1280 CSS px or wider, and phone width, about 390 CSS px.
- Light and dark theme. When the app has only one theme, capture that one and say so in the report.
- Every project locale, including each RTL one, for example `he`, `ar`, and `en`. Use realistic content, including text that mixes RTL and LTR scripts and the longest label in each locale.

Set language, direction, and theme through the app's own switch or setting, or the browser's color-scheme preference when the app follows the system. Do not inject `lang`, `dir`, or theme attributes. Save desktop captures under `desktop/` and phone captures under `mobile/`. Name each file `<flow-or-screen>-<step>-<locale>-<light|dark>.png` in both.

## Critique

Spawn two fresh reviewers that did not write the UI. One is a Claude model and one is a Codex or GPT model. Each sits on the `judgment and prose` seat. Claude reads that line in `.claude/pstack-models.md`; Codex reads it in `.codex/pstack-models.md`. Run the other family on the same seat of its own sheet.

Give them the screenshots, the personas, the flows, and `references/checklist.md`. Do not give them the code. Each reviewer opens and looks at every screenshot and judges small and big issues alike: layout and cramping, such as an icon stacked over its label; text cut, or an ellipsis on the wrong side, in mixed-direction text; density, such as rows taller than their content needs; and whether the screen is intuitive and makes sense. Every screenshot finding cites the screenshot file that shows it. Drop a screenshot finding that cites no screenshot.

Each reviewer works in two passes:

1. As a senior UI/UX expert, check every screenshot against the checklist: heuristics, accessibility, RTL and LTR, layout and density, light and dark, hierarchy, and perceived performance.
2. As each persona in turn, walk each flow and report where that person would hesitate, misread, or give up.

Tag each finding with its checklist item, for example `[N9]`, `[WCAG 1.4.3]`, or `[HIG RTL]`. Label a finding with no tag `opinion`.

When the second reviewer cannot run, follow poteto-mode's `BLOCKED: independent review` rule. Keep the first report and name the missing reviewer.

## Behaviour checks

Screenshots do not show how a screen behaves. Exercise these in the running app: a persistent shared layout, loading scoped to the part that is loading, pending or click feedback, and focus and keyboard. Cite the source for each finding and tell the reviewers where these live:

- `../web-design-guidelines/REFERENCE.md`, the pinned rules. Tag `[WDG]`.
- `../vercel-react-best-practices/SKILL.md`, for React and Next.js code. Tag `[VRBP]`.
- When the project uses Next.js, the docs in `node_modules/next/dist/docs/`. Read the installed version. Tag `[Next docs]`.

## Prototype fidelity

When the project keeps a prototype of its screens, this pass is required. The project says which prototype capture shows which screen and state, for example in `docs/ux-critique/README.md`.

For each prototype screen that shows a screen the build adds or changes, and for each of its captures in every locale and viewport, find the build screenshot of the same screen and state in that locale and viewport. Pair desktop with desktop and phone with phone. If no such build screenshot exists, capture it. If the build has no such screen or state, that is a P1 gap. Give each reviewer the prototype capture beside the build screenshot. Each reviewer compares the layout, the navigation, the components, and the copy, and gives each gap one of these priorities:

- P1. A person would act differently from the prototype's design. Examples are a missing screen or state, a different way to reach the screen, a missing or different primary action, and copy that says something else.
- P2. The task works the same way, but the layout, a component, or a label differs in a way a person notices.
- P3. A cosmetic difference, such as spacing, alignment, an icon, or wording with the same meaning.

These priorities rank fidelity gaps only. The other findings keep their own severity. A build screen with no prototype screen has nothing to compare with. The reviewer names it.

## Report

Write one markdown file for the human, `docs/ux-critique/<feature>.md`, with the screenshots in `docs/ux-critique/<feature>/desktop/` and `docs/ux-critique/<feature>/mobile/`. For each flow, link its desktop and mobile screenshots, then list each finding with its screenshot, severity, checklist tag or `opinion`, persona, locale, viewport, theme, reviewer, and whether the other reviewer agrees or disagrees. End with the top 5 fixes.

When the project keeps a prototype, add a "Prototype fidelity" section. List each gap with its screen, locale, viewport, what the prototype shows, what the build shows, and its priority. Name each build screen that has no prototype screen. The report is not done without this section.

Do not fix anything in this pass.
