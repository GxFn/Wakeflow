# Wakeflow Skill & Process Writing Style

How to write and sharpen a Wakeflow skill, reference, or standard-process doc. Borrowed from the
`superpowers` plugin's skill-writing craft. Apply it when authoring or editing any skill / reference /
template / standard process in this plugin.

## Core principle

A skill is a sharp reference future agents scan under pressure — not a narrative. Optimize for
*found fast, scanned fast, applied correctly*. Prose buries the rule; structure surfaces it.

## Format conventions

| Convention | Rule |
|---|---|
| **Iron Law** | For a hard rule, lead with one bold non-negotiable sentence (e.g. `NO ACCEPTANCE WITHOUT FRESH RAW-EVIDENCE.`). One per gate — three rules means three gates. |
| **Letter = spirit** | Add once, early, to a hard rule: "Violating the letter of this rule is violating its spirit." It closes the "I'm following the spirit" loophole. |
| **Rationalization table** | Pre-empt shortcuts with a `\| Excuse \| Reality \|` table — sharper and more scannable than prose warnings. |
| **Red Flags — STOP** | A short bullet list of the thoughts that mean "you are rationalizing right now", so the agent can self-check. |
| **Close loopholes** | Don't just state the rule — forbid the specific workarounds ("don't keep it as reference"; "close-enough is not done"; "a partial check proves nothing"). |
| **No-placeholder list** | For artifacts (requirement designs, task packages, plans), list the failures explicitly: no `TBD`, no "handle edge cases" without specifics, no undefined references. |
| **Tables/lists over prose** | Reference material is a table or list. Reserve a small flowchart for a genuinely non-obvious *decision* only — never for linear steps or code. |
| **Rigid vs flexible** | Label a gate: *rigid* (follow exactly — evidence, no-placeholder, boundaries) or *flexible* (adapt to context — scope, sequencing). |
| **Quick Reference + Common Mistakes** | A scan table and a "what goes wrong + fix" section beat a wall of prose. |

## Description (CSO)

A skill's `description:` names **WHEN to use it (triggering conditions), never WHAT it does (a
workflow summary)**. A description that summarizes the workflow becomes a shortcut the agent follows
*instead of* reading the skill body. Start with "Use when …".

- ❌ `Use when reviewing results — pull evidence, check behavior, then decide accept/rework`
- ✅ `Use when reviewing a target result before an accept / rework / block decision`

## Token efficiency

Hot skills (loaded often) stay lean — aim under ~200 words of body; move detail to an on-demand
reference and point with `**REQUIRED:** read references/X.md`. Don't repeat what a cross-referenced
skill already says. One excellent example beats five mediocre ones.

## Borrowed clauses worth reusing

Drop these in where they fit Wakeflow's flow (they are sharp, model-agnostic statements of a rule):

- "If you didn't watch the test fail, you don't know if it tests the right thing." — test-first.
- "Evidence before claims, always." — acceptance.
- "3 fixes failed ⇒ question the architecture; don't fix the same chain again." — debugging a stuck loop.
- "Too simple to need a design" is the anti-pattern — every requirement gets a design, scaled to size.
- "External feedback is suggestions to evaluate, not orders to follow." — controller vs Design/script suggestions.
- "Assume the reader has zero context and questionable taste." — write the artifact for a stranger.
- "Separate fact, suggestion, and decision." — Design handoff and controller review.

## Naming

Verb-first / gerund names that say what you DO or the core insight: `reviewing-results`, not
`result-review`; `verification-gate`, not `acceptance-helper`.
