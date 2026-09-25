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

## Verdicts

Each step gets exactly one verdict: `pass` when the observation matches the
baseline; `fail` when it does not; `blocked` when the step could not run;
`cannot-conclude` when it ran but the observation does not decide the step
either way. Wakeflow derives the run's verdict from the steps - any `fail`
makes it fail, otherwise any `blocked` makes it blocked, otherwise any
`cannot-conclude`, otherwise pass - so a single mislabeled step misroutes the
whole run.

## Classifying a failure

Every step that did not pass needs a classification, a likely owner
(`implementation`, `test`, `environment` or `user`) and a recommended action,
because the classification is what determines the Controller's next move.
Getting it wrong costs a full cycle in the wrong direction.

- **`product-defect`** - the product behaves differently from what the
  acceptance criterion requires, and the step and the environment are sound.
  This is the classification that authorizes remediation on the
  implementation, so use it when you have actually established the product is
  wrong, not when you suspect it. Owner: implementation.
- **`harness-defect`** - the step itself is wrong: it tests the wrong thing,
  its baseline is stale, its setup is incomplete. Say precisely what is wrong
  with it; the Controller cannot repair a step from "did not work". Owner:
  test.
- **`flaky`** - the same step produced different results across runs with
  nothing else changed. Report how many times you ran it and what each run
  did. Do not report the passing run alone.
- **`missing-evidence`** - the step ran but you cannot produce the evidence
  that shows what it did. Treat this as a failure, not a pass.
- **`environment`** - the environment could not support the step at all.
  This blocks rather than reruns, and it is not the product's fault.
- **`out-of-scope`** - what the step exposed is real but lies outside the
  contract's object boundary. Report it; do not chase it.
- **`needs-decision`** - the step cannot be judged without a decision only the
  user can make (an ambiguous criterion, a conflicting instruction). Owner:
  user. The Controller escalates it rather than guessing.

Only harness defects, flakiness and missing evidence can justify another
attempt, and only inside the attempt budget. That is the whole reason the
classification matters.

## Before you call a step a product defect

A log line without a reproducible signal is an observation, not a diagnosis.
Build the feedback loop first, in this order, using the first form that can
observe the behavior: an existing targeted check at the public seam; a
CLI, API or UI action with an explicit expected output; a replay of a bounded
request, event or fixture; a Test-owned harness under the Test surface when
the contract allows one; repeated runs when you suspect flakiness. Then form
falsifiable hypotheses and probe one variable at a time. Never edit product
source to create observability - if the behavior cannot be observed with what
the contract gives you, that is `missing-evidence` or `environment`, reported
to the Controller.

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

You make that record yourself, because the Controller did not watch the run:
write the step's exact output to a file under the Test surface (for example
`fixtures/<demandId>/<stepId>.txt`), then call `wakeflow_record_evidence` for
this Demand with kind `test-output` and a managed-path source naming that
surface and file. Preview shows the privacy scan; apply returns the locator
and digest. One record per step keeps the citation exact.

Keep the exact output rather than a summary, and keep it per step rather than
one blob for the whole run - a reviewer comparing one step against its
baseline should not have to search.

Do not write hook record ids, session ids or other bare UUIDs into the output
you record or the report you import - the import refuses them and evidence
capture asks for confirmation - and refer to Wakeflow objects by their typed
ids (`demand_…`, `target-task_…`) only.

## What the report has to say

Per step: what was expected, what was observed, the verdict, the
classification when it failed, and the evidence reference. Wakeflow derives
the overall verdict from these records, so do not assert an overall pass or
fail yourself.

Then one paragraph on coverage honesty: which steps did not run, which
conditions you could not reach, and anything that passed for a reason you could
not confirm. A test report whose value is "everything passed" and nothing else
is the report that lets a defect through.

## Before you import

Check your own records once, as the reviewer will:

- every step inside this attempt's scope appears exactly once, none is
  invented and none is missing (a `completed` outcome requires all of them);
- every evidence locator resolves to a managed record of this Demand and its
  digest matches;
- every step that did not pass carries its classification, owner and
  recommended action;
- an unrun step is `blocked` with the reason, not omitted;
- no secret, private handle, absolute local path, bare UUID or unbounded log
  is in any text you are about to import.

This review makes your own report honest; it is not the Controller's review
and it does not accept anything.
