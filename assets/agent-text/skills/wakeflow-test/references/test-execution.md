# Running a frozen test contract

Read this before you run the first step. It is test depth; the boundaries and
the import procedure are in `SKILL.md` and in the target skill.

## The contract is frozen on purpose

The Controller wrote the approved steps, bound each one to an
acceptance-criteria item, and froze the setup, the allowed skills, the attempt
budget and the stop conditions. Freezing is what makes the run mean something:
a test you adjusted until it passed tests your adjustment, not the product.

So you execute the contract as written. Every disagreement with it becomes a
report, never an edit.

## Before the first step

1. Do the setup exactly as the contract names it.
2. Confirm the landing: the branch and commit the implementation reported are
   the ones you are about to test. Testing a different revision produces a
   confident, useless result.
3. Confirm the environment is the one the contract names. If it is not, stop -
   this is an environment failure, and reporting it immediately is worth more
   than a run nobody can interpret.

## Running one step

For each approved step, in order:

1. Run it as written.
2. Capture what it actually did: the output, the state, the observable
   behavior.
3. Compare against the step's approved baseline.
4. Write the observation in observable terms. "Exit status 1 and the message
   about a missing config" is an observation. "Broken" is a judgment, and it
   throws away the information the Controller needs.
5. Record the verdict for that step, and cite the evidence record for it.

Never report a step you did not run. An unrun step is reported as unrun, with
the reason. There is no situation where inferring a step's result from a
neighboring step is acceptable.

## Classifying a failure

Every failing step needs a classification, because the classification is what
determines the Controller's next move. Getting it wrong costs a full cycle in
the wrong direction.

- **product defect** - the product behaves differently from what the
  acceptance criterion requires, and the step and the environment are sound.
  This is the classification that authorizes remediation on the
  implementation, so use it when you have actually established the product is
  wrong, not when you suspect it.
- **harness defect** - the step itself is wrong: it tests the wrong thing,
  its baseline is stale, its setup is incomplete. Say precisely what is wrong
  with it; the Controller cannot repair a step from "did not work".
- **flaky** - the same step produced different results across runs with
  nothing else changed. Report how many times you ran it and what each run
  did. Do not report the passing run alone.
- **missing evidence** - the step ran but you cannot produce the evidence that
  shows what it did. Treat this as a failure, not a pass.
- **environment failure** - the environment could not support the step at all.
  This blocks rather than reruns, and it is not the product's fault.

Only harness defects, flakiness and missing evidence can justify another
attempt, and only inside the attempt budget. That is the whole reason the
classification matters.

## Attempts and stop conditions

The contract froze an attempt budget and stop conditions. Honor both. When the
budget is spent, report that it is spent along with what each attempt did -
continuing past it turns a bounded test into an unbounded one and hides the
instability you were supposed to surface.

If a frozen stop condition is met, stop there, even mid-contract, and report
which condition and what triggered it.

## Evidence for a step

A step's observation is only as good as the record behind it. Cite a managed
evidence record of this Demand by its locator and digest; raw output that was
never recorded is not evidence, and an import that cannot resolve a locator or
whose digest does not match is refused.

Keep the exact output rather than a summary, and keep it per step rather than
one blob for the whole run - a reviewer comparing one step against its
baseline should not have to search.

## What the report has to say

Per step: what was expected, what was observed, the verdict, the
classification when it failed, and the evidence reference. Wakeflow derives
the overall verdict from these records, so do not assert an overall pass or
fail yourself.

Then one paragraph on coverage honesty: which steps did not run, which
conditions you could not reach, and anything that passed for a reason you could
not confirm. A test report whose value is "everything passed" and nothing else
is the report that lets a defect through.
