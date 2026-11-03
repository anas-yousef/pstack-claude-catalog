# UX critique checklist

Tag each finding with the item's tag, for example `[N9]` or `[WCAG 1.4.3]`. A finding with no tag is labelled `opinion`.

## 1. Heuristics

- [N1] Does every action show its status or result? [N2] Do labels use the user's words, not internal terms?
- [N3] Can the user undo, go back, or leave each step without losing work? [N4] Do the same words and icons mean the same thing everywhere?
- [N5] Do constraints, defaults, or a confirm step prevent errors? [N6] Are options visible, not remembered from an earlier screen?
- [N7] Can a repeat user go faster without confusing a new one? [N8] Does each screen show only what this step needs?
- [N9] Does each error say in plain language what went wrong and how to fix it? [N10] Is help available where the user gets stuck?
- [Lens] As a first-time user: what is this screen for, and what do I do next? Adopt this lens only, not the source's hard gates or verdicts.

## 2. Accessibility, from screenshots

Items are screening prompts that summarize each success criterion; the criterion's own exceptions in WCAG 2.2 apply, and a reviewer flags a likely failure, not a certified one.

- [WCAG 1.4.3] Does text contrast reach 4.5:1, or 3:1 for large text? Exempt under 1.4.3: logotypes and incidental text, such as text in inactive controls, pure decoration, invisible text, or text in a picture with significant other visual content. [WCAG 1.4.11] Does the visual information needed to identify controls and their states, and to understand graphics, reach 3:1 against adjacent colors? Exempt under 1.4.11: inactive controls, unmodified user-agent controls, decorative or redundant visuals, and graphics whose particular presentation is essential to the information.
- [WCAG 1.4.1] Is meaning shown by more than color? [WCAG 1.4.10] Does content reflow at 320 CSS px without horizontal scrolling? Content that needs a two-dimensional layout, such as maps and data tables, is exempt.
- [WCAG 2.4.7 / 2.4.11] Is keyboard focus visible, and not completely hidden by a sticky header, banner, or dialog? [WCAG 2.4.12, AAA] Is it not even partly hidden?
- [WCAG 2.5.8] Is each target at least 24x24 CSS px? If not, a 24 CSS px circle centered on it must not intersect another target or another undersized target's circle. Other exceptions: an equivalent passing control, targets inline in text, size set by the user agent, and essential presentation.
- [WCAG 3.3.2] Does each field have a label or instructions? [Practice] Is the label visible? [WCAG 3.3.1] When an input error is detected automatically, does text identify the item in error and describe the error? A literal field name is not required.
- [WCAG 3.1.1 / 3.1.2] Is the language of the page, and of each passage in another language, set in markup? Proper names, technical terms, words of indeterminate language, and words adopted into the surrounding language are exempt. Screenshots cannot show this, so mark it unverified. [Practice] Does each language render in the right script and font?
- Code-level checks: `../../../references/accessibility-checklist.md` and `../../frontend-ui-engineering/SKILL.md`.

## 3. RTL, LTR, and i18n

- [HIG RTL] Does text align with the interface direction, while a paragraph of 3 or more lines aligns with its own language? Are list items aligned the same way?
- [HIG RTL] Do digits inside a number, such as a phone or card number, keep their order? Do progress bars, sliders, and ratings run in the interface direction?
- [HIG RTL] Do navigation and progress controls flip, so that back points right in RTL? Do controls for a real direction, such as rewind, stay unflipped?
- [HIG RTL] Do adjacent Latin and RTL scripts look balanced in size and weight? Does each locale use its expected numerals?
- [HIG RTL] Does mixed-direction text, such as names, numbers, and punctuation, render in the right order?
- [Practice] Does longer translated text fit without truncation or clipping? [N2] Does the copy read as written in that language, not translated?

## 4. Visual hierarchy and consistency

- [N8] Is the primary action on each screen the most obvious one? [Practice] Do spacing and alignment follow one rhythm?
- [N4 / WCAG 3.2.4] Is a component with the same function identified the same way, by label, icon, or name, on every screen? [Practice] Does it also look the same?
- [N1 / N9] Are the empty, loading, and error states designed, not blank or raw?
- Build guidance: `../../frontend-ui-engineering/SKILL.md`.

## 5. Perceived performance

- [CWV] Targets at p75: LCP at most 2.5 s, INP at most 200 ms, CLS at most 0.1. Screenshots cannot measure them, so mark any metric conclusion unverified without measurements.
- [N1] Does a slow screen show a loading or skeleton state? [CWV CLS] Does content move unexpectedly? Only shifts within 500 ms of a click, tap, or key press are excluded; later shifts count, including a delayed response to a click.
- [CWV INP] Does each action show feedback at once, not a control that looks frozen?
- To measure: `../../performance-optimization/SKILL.md` and `../../../references/performance-checklist.md`.

## Sources

- N1-N10: Nielsen Norman Group, 10 usability heuristics. https://www.nngroup.com/articles/ten-usability-heuristics/
- Lens: jezweb ux-audit, first-time-user lens. https://github.com/jezweb/claude-skills/blob/main/plugins/dev-tools/skills/ux-audit/SKILL.md
- WCAG: Web Content Accessibility Guidelines 2.2. https://www.w3.org/TR/WCAG22/
- HIG RTL: Apple Human Interface Guidelines, Right to left. https://developer.apple.com/design/human-interface-guidelines/right-to-left
- CWV: Core Web Vitals. https://web.dev/articles/vitals
- Practice: common practice with no external source. Weigh it below a sourced item.
