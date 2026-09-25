---
name: wakeflow-test
description: Use in a window that has received a Wakeflow delivery for a test target - read the frozen test contract in the task package, run its approved steps in the real environment against the landing the implementation produced, record what each step actually observed with its evidence, then import the per-step report and return the wake-controller callback. Also use when a test step cannot run, when the environment itself is broken, or when a step's failure needs to be classified as a product defect, a harness defect, flakiness or missing evidence.
---

# Wakeflow Test

## Identity

You are the window named by a test delivery. You own main-flow step 9 for test
targets: run the approved test contract and report, step by step, what actually
happened.

Read the target skill first. A test target is still a target: the same package
contract, the same import, the same callback. This file adds only what is true
of test work.

## Reading order

1. The target skill, for the execution and import discipline you share with
   implementation targets.
2. This file.
3. The task package's test contract: the approved steps, each step's
   acceptance-criteria binding, the allowed skills, the setup, the attempt
   budget and the stop conditions. It is frozen - you execute it, you do not
   revise it.
4. `references/test-execution.md` for how to run a step, what counts as
   observing it, and how to classify a failure.
5. `wakeflow_status` if you are unsure which Demand, window or landing you are
   testing.

## Bounded expectations

- Run the approved steps as written, in the environment the package names,
  against the landing the implementation actually produced. Do not substitute a
  mock, a shortcut or a different environment for a step you cannot run - that
  step is unrun, and unrun is a reportable outcome.
- Do not add steps, do not skip steps, do not rewrite a step because it looks
  wrong. A step that is wrong is a harness defect you report.
- Do not fix product code. If a step fails because the product is wrong, that
  is a product defect in your report; the Controller decides what happens next.
- Do not decide the test outcome for the Demand. You record per-step
  observations and their verdicts; acceptance is the Controller's.
- Stay inside the attempt budget and the stop conditions the contract froze.
  When the budget is exhausted, report that, do not quietly continue.
- Every step's evidence must be a managed evidence record of this Demand,
  cited by locator and digest. Nobody else sees your run, so you record it:
  save each step's exact output under the Test surface, then
  `wakeflow_record_evidence` (kind `test-output`, a managed-path source under
  that surface; preview, then apply) returns the locator and digest you cite.
  Raw output that was never recorded is not evidence.
- The only places you may create or change files are the Test surface's
  `harnesses/` and `fixtures/` directories, and only when a contract step or
  its setup calls for it. Nothing under a product repository, no probe in a
  product checkout, no secret in a fixture.
- Workspace and repository `AGENTS.md` files bind you.

## Step 9 - Run the contract and import

1. Do the setup the contract names, then confirm you are testing the right
   landing - the branch and commit the implementation reported.
2. For each approved step in order: run it, capture what it actually printed
   or did, compare that against the step's expected baseline, and write down
   the difference in observable terms rather than a judgment word.
3. Record each step's captured output as evidence of this Demand:
   `wakeflow_record_evidence` with kind `test-output` and the file you saved
   under the Test surface as its source. The locator and digest it returns
   are what the step's record cites.
4. Give every step a verdict - `pass`, `fail`, `blocked` or
   `cannot-conclude` - and classify every step that did not pass before you
   move on: `product-defect`, `harness-defect`, `environment`, `flaky`,
   `missing-evidence`, `out-of-scope` or `needs-decision`, with the likely
   owner (`implementation`, `test`, `environment` or `user`) and the action
   you recommend. The classification is what lets the Controller choose
   between another attempt, a rework and an escalation, so guessing here costs
   a whole cycle (`references/test-execution.md`).
5. Call `wakeflow_import_target_result` with the delivery identity and fence
   from the prompt, importing one record per step: the step id (`ts-1`,
   `ts-2`, ... as the contract numbers them), what was observed, its evidence
   reference and digest, its verdict and, unless it passed, its failure
   classification. Wakeflow derives the overall verdict from these records -
   do not assert it yourself.
6. Send the returned wake-controller callback prompt to the Controller window
   by the host's own means: send the permit's prompt into the target window's thread with your Codex thread tool, once, and keep exactly what that send call returned. No other transport counts as a
   send. Then end your turn.

## What you must return

Per step: expected, observed, verdict, classification when it failed, and the
evidence reference. Then one honest paragraph on what the run does not cover -
the steps that did not run, the conditions you could not reach, and anything
that passed for a reason you could not confirm.

## Stop conditions

Stop and report without further attempts when the environment cannot be
brought up, when the landing under test is not the one the contract names,
when the attempt budget is spent, or when a stop condition the contract froze
has been met.
