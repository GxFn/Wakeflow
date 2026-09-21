# Craft: how to execute a target task

Read this before you change code. It is target depth; the boundaries and the
import procedure are in `SKILL.md`.

## The order that keeps a change honest

1. **Read the package before the code.** Restate the goal in one sentence and
   write down the boundary. If you cannot restate it, the problem is
   comprehension, not implementation, and asking now costs one turn while
   guessing costs a whole review cycle.
2. **Reproduce or observe the current behavior.** Before you believe a
   description of a defect, see it. Before you believe a feature is missing,
   check that it is missing rather than merely differently named.
3. **Diagnose against the code as it is.** Find the place where the current
   behavior is actually produced. A fix applied one layer away from the cause
   is the change most likely to be accepted and most likely to be wrong.
4. **Choose the smallest coherent change.** Smallest is not "fewest lines" -
   it is the change that a reviewer can hold in their head and that does not
   leave the code in a half-migrated state.
5. **Make it.** Follow the conventions the file already uses, not the ones you
   prefer.
6. **Check it.** Run what the package expects, and keep what it printed.
7. **Re-read your own diff** as though someone else wrote it, before you write
   the report.

## Staying inside the boundary

The boundary paragraph in the package is a hard limit, not advice.

- A file outside the assignment stays untouched even when the fix would be
  easier there. Report it.
- A refactor you did not need in order to do the task is out of bounds, even a
  good one. Report it as an observation.
- Fixing an unrelated defect you happened to notice is out of bounds. Report
  it; a reviewer can turn it into its own task in a minute.
- Deleting or rewriting a test to make your change pass is never in bounds.
  A test that is now wrong is a finding you report, with the reason it is
  wrong.

If the assigned work genuinely cannot be done without leaving the boundary,
stop and report that. Unbounded work is the one failure a reviewer cannot
correct after the fact, because they cannot see what you decided not to say.

## Working inside a worktree

When your delivery assigns a worktree, that checkout is your entire world. Do
not reach into the main checkout or another worktree to read "just one file";
their state is not the state you are working against. Keep your work on the
branch the assignment names, and report the branch and the commit exactly as
they are.

Never rewrite history, never force a branch, never touch another window's
working tree.

## Evidence while you work

You cite evidence at import time by locator and digest, and the locators must
resolve to records that already exist for this Demand. So while you work:

- Keep the actual output of the checks you ran, not your summary of it.
- Note the exact command and the exact revision you ran it at.
- Do not paste an absolute local path or a private handle into anything that
  will end up in the report - the import scan refuses it and you will have to
  rewrite the report.

If a check you were expected to run could not run, that is a fact about the
environment worth reporting precisely: what you tried, what it did instead.

## Answering the acceptance anchors

Each anchor is bound to an acceptance-criteria item in the requirement. Answer
every one of them explicitly:

- **satisfied** - and the specific observation that shows it. A file name and
  the behavior you saw beats an adjective.
- **not satisfied** - and what is missing. This is a normal outcome, not a
  confession.
- **blocked** - and what blocked it.

Do not mark an anchor satisfied because the code now looks like it should
work. The reviewer is going to check, and a claim that does not survive that
check costs far more than an honest "unverified".

## Writing the report

Write it for someone who did not watch you work and will read your diff:

- **Outcome** in one line.
- **What changed and why** - the diagnosis, then the change, then why this
  change and not the larger one you considered.
- **Branch and commit.**
- **Per-anchor answers** with observations.
- **Evidence locators.**
- **What you did not do** - the boundary you respected, the adjacent problems
  you saw, the cleanups you left alone.
- **Residual risk** in one paragraph: what could still be wrong, what you could
  not verify, what would fail first if you are mistaken.

The last two sections are the ones a reviewer values most and the ones an
agent is most tempted to leave out. A report with no uncertainty in it reads
as a report that did not look.

## Things that look like progress and are not

- Broadening a change until the check passes for a reason you cannot name.
- Adding a special case for the exact input the check uses.
- Silencing a warning, a type error or a failing check rather than resolving
  it.
- Declaring success from a partial run.
- Re-running a flaky check until it is green and reporting only the green run.
