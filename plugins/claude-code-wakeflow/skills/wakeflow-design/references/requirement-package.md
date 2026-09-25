# Writing a requirement package

Read this before you write the first section. It is Design depth; the
boundaries are in `SKILL.md`.

## The package is the whole handoff

A requirement package is two documents plus optional text attachments:
`requirement.md` says what must become true, `landing.md` says what is
already true in the code and how the change lands. Once published, the record
is immutable. A correction is a new package.

Everything an implementer will ever learn from you is in here. Anything you
only said in the conversation is lost.

## Before you write

The conversation is where the requirement becomes concrete; the package only
records the result. While it is still fuzzy:

- Repair an activity goal ("improve it", "continue") into an observable
  outcome with an actor: who does what, and what they see afterwards.
- Establish read-only facts from the code before asking the user for them.
  Ask only questions whose answer changes the goal, the scope, the acceptance
  criteria or the testing decision - one consequential question at a time,
  with your recommended answer and its trade-off.
- Keep verified facts, your recommendations, the user's decisions and open
  questions apart. A recommendation the user has not confirmed is not scope.

## Sections

Headings are matched by name, in either language, so write natural headings.
Each demand type requires a different set, and a missing section is reported by
preview before the user ever sees the package.

**requirement** - a new capability:

- `requirement.md`: goal, completion definition, non-goals, acceptance
  criteria, user confirmation.
- `landing.md`: code facts, landing plan, testing decision.

**bug** - something is wrong:

- `requirement.md`: reproduction, scope, non-goals, user confirmation.
- `landing.md`: code facts, fix plan, testing decision.

**supplement** - an addition to work already done:

- `requirement.md`: requirement delta, completion definition, user
  confirmation.
- `landing.md`: code facts, landing plan, testing decision.

**research** - a question to answer, not code to ship:

- `requirement.md`: research question, boundaries, user confirmation.
- `landing.md`: known facts, method.

## What each section has to carry

**Goal, requirement delta, research question or reproduction.** The single
thing this package exists for, in the user's terms. For a bug, reproduction
means the exact steps and the observed wrong behavior, not a theory about the
cause.

**Completion definition.** What is observably true when this is done. Write
it so that someone who did not read the discussion can check it.

**Non-goals.** What this package deliberately does not do. This is what
prevents a target from widening the change, so name the adjacent work that
someone would otherwise be tempted to include.

**Scope / boundaries.** Which repositories, which areas, which are untouched.

**Acceptance criteria.** A numbered list of independently checkable items.
These are load-bearing: the Controller binds each task's acceptance anchors to
these items by their position, and a target's report answers them one by one.
So each item must be:

- observable - a behavior, an output, a state, not an intention;
- singular - one item, one check;
- stable - it will still mean the same thing after the code changes;
- stated without naming an implementation, unless the implementation is the
  requirement.

Do not write an item you have no way to check. Write the question for the user
instead.

**User confirmation.** Who confirmed what, and when. This section exists
because publishing without the user's confirmation is the failure the flow is
built to prevent.

**Code facts.** What you verified by reading the product repositories: files,
symbols, current behavior, and the places the change touches. Every claim here
must come from a file you actually opened. This is the section that makes the
difference between a requirement an implementer can act on and one they have
to re-investigate from scratch.

**Landing plan or fix plan.** Where the change lands and what it affects.
Enough for the Controller to split it into tasks; not a line-by-line design.

**Testing decision.** Whether this needs real-environment testing, and if so
what environment and what has to be exercised. The Controller freezes a test
contract from this, so vagueness here becomes an untestable contract later.

**Known facts and method** (research only). What is already established, and
how the question will be answered.

## The summary and confirmation point 1

Preview returns a one-page summary drawn from the goal-level sections, the
completion definition, the non-goals, the scope and the testing decision. That
summary is what the user confirms.

Give it to them verbatim. Do not paraphrase it into something more agreeable,
and do not answer on their behalf because the intent seems obvious. If the
summary reads wrong to you, the package is wrong - fix the draft and preview
again.

## Privacy

The scan refuses credentials outright and flags unlisted absolute local paths.
Neither belongs in a package that will be read by other windows and archived
forever. Refer to a file by its repository-relative path; refer to a service by
its name, not by a token.

## Skeletons

Start from these when the drafts directory is empty. The headings are the
ones preview recognizes; the prompts under them are what to replace. For a
`bug`, `supplement` or `research` package swap in the headings its section
list names above (`Reproduction`, `Scope`, `Fix plan`; `Requirement delta`;
`Research question`, `Boundaries`, `Known facts`, `Method`).

`requirement.md`:

```markdown
# <Title>

## Goal
What changes for whom, in the user's terms. One paragraph.

## Completion definition
What is observably true when this is done.

## Non-goals
- The adjacent work this package deliberately leaves alone.

## Acceptance criteria
1. One observable, singular, stable check.
2. ...

## User confirmation
Who confirmed which summary, and when.
```

`landing.md`:

```markdown
# <Title> - landing

## Code facts
- `path/in/repository`: what it does today (from the file you opened).

## Landing plan
Which repository and area the change lands in, and what it touches.

## Testing decision
controller-only | real-environment | not-applicable - and for a real
environment: which environment, what has to be exercised, what a pass and a
fail mean.
```

## Before you preview

- Every factual claim traced to a file you opened.
- Every acceptance criterion checkable by someone else.
- Non-goals written down, not assumed.
- No absolute local path, no credential, no private handle.
- The demand type's required sections all present, with real content under
  each - an empty heading is a missing section with extra steps.
