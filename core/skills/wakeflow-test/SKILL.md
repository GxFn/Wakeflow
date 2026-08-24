---
name: wakeflow-test
description: Use when a Wakeflow Test window receives a controller-approved implementation-validation task or a controller-scoped Test-only reproduction or environment-diagnostic task and needs a bounded testing method.
---

# Wakeflow Test

Load this Skill alongside `wakeflow-target`. The target Skill owns receipt,
identity, exact Test-step mapping, result recording, and return transport. This
Skill owns only the Test method inside the frozen card/package boundary.

## Iron Laws

**TEST EXECUTES ONLY A CONTROLLER-FROZEN QUESTION, ENVIRONMENT, PLAN, AND METHOD.** Violating the letter of this rule is violating its spirit.

**PRODUCT SOURCE IS READ-ONLY, ALWAYS.** A Test card cannot authorize product
implementation or repair. Test may inspect product code and diffs, but must not
edit, format, generate, vendor, commit, or otherwise mutate product source,
tests, configuration, or documentation. Read-only inspection may explain a
mapped Test observation; product-diff and target-result review remain controller
work.

**TEST EVIDENCE IS REVIEW INPUT, NEVER CONTROLLER ACCEPTANCE.** A self-review,
passing run, or strict `TargetResult` cannot accept implementation or complete
a demand.

## Wakeflow Role And Entry Gates

Proceed only through one of these controller-owned routes:

1. **Controller-accepted implementation validation:** every active required
   non-Test target for the scope is already accepted, valid superseded history
   is excluded, and `controllerSelfChecks` explains what was independently
   verified and which real-environment risk remains.
2. **Controller-scoped Test-only diagnostic:** the controller explicitly
   bounded a reproduction or environment diagnostic that does not depend on
   unfinished implementation acceptance.

If neither route is explicit, return `blocked` or `needs-review`. Do not infer
that a smoke-test request, accessible environment, or available time opens a
Test scope.

## Required Inputs

Read the immutable dispatch packet plus its exact TaskPackage and TestCard
references, then verify:

- `testContract.executionContract.requirementGoal` and the exact controller
  question in the TestCard `boundaryGate`;
- `testContract.executionContract.approvedPlan` and zero-based step mapping;
- confirmed Test Environment Spec and allowed operations;
- `controllerSelfChecks` or the explicit Test-only diagnostic boundary;
- exact `executionContract.allowedSkills`, setup policy, attempt bound, restart
  rule, change control, success, failure, invalid conclusions, and stop
  conditions;
- TestCard `evidenceRequired`, packet `reviewInputContract`, and strict
  `resultContract`.

Missing or conflicting input is a blocker to the controller. Never choose an
environment, invent a config value, add a goal/gate/method, or run an unmapped
step first and justify it later.

## Source Skills Used

- `senior-qa`: choose evidence by risk, confidence, and cost, and prefer the
  lowest layer that proves the behavior.
- `diagnose`, `systematic-debugging`, and `triage`: establish a feedback loop,
  reproduce, rank falsifiable hypotheses, probe one variable, and classify
  ownership.
- `tdd`: use a public seam, fail-before/pass-after signal, and one tracer
  bullet for regression advice.
- Evidence discipline retained from `code-reviewer` and `senior-qa`: review
  only Test's own mapping, reproducibility, redaction, limitations, and
  residual risk before return; product review remains with the controller.

## Route The Method

Load only methods authorized by the current card/package:

| Need | Required reference |
| --- | --- |
| Refine the approved plan by risk and evidence fit | [Risk strategy](references/risk-strategy.md) |
| Reproduce and classify an approved failure | [Debugging and triage](references/debugging-triage.md) |
| Advise durable coverage after a confirmed behavior/repro | [Regression advisory](references/regression-advisory.md) |
| Check Test's own evidence before result recording | [Self-evidence review](references/self-evidence-review.md) |

An empty `executionContract.allowedSkills` set authorizes no optional method.
It does not prevent execution of the already approved operational steps.

## Mutation Boundary

Product repositories remain read-only. The card may explicitly authorize only:

- bounded operations in the confirmed Test environment; and
- creation or modification of Test-owned assets under the Test surface's
  `harnesses/` or `fixtures/` capability roots.

Both permissions must be written in the card/package and mapped to an approved
step. They do not authorize product test files, temporary probes in a product
repository, secrets in fixtures, unsafe reset/delete actions, or an expanded
environment. External Test owners keep their own equivalent Test-owned paths;
Wakeflow does not invent them.

## Exact Result Evidence

`wakeflow-target` owns the full result-recording procedure. Test must supply its
portion in the current strict shape:

- `artifactKind` is `wakeflow-target-result`.
- Each `evidenceLocators` entry is exactly `{ kind, ref, digest }`; every kind
  required by `reviewInputContract.requiredKinds` must be present for a
  `completed` result.
- Each `craftMapping` entry is exactly
  `{ kind: "test-step", planIndex, step, ref }`. `step` must byte-match
  `executionContract.approvedPlan[planIndex]`, and `ref` must identify exactly
  one declared evidence locator.
- A `completed` Test result maps every approved plan step exactly once and in
  order. It contains no `acceptance-anchor` mapping.
- `blocked` or `needs-review` may be partial, but the evidence and mappings that
  are returned must remain exact and honest.

## Workflow

1. Pass the entry gate and required-input check.
2. Map each intended action to the approved plan and requirement goal.
3. Load only the authorized focused method.
4. Execute within the confirmed environment and mutation boundary, respecting
   attempt/restart/stop rules.
5. Record exact commands or observations, outcomes, portable evidence refs,
   flakiness, limitations, and residual risk.
6. Run the self-evidence review without reviewing product completion.
7. Return through `wakeflow-target` with an honest strict `TargetResult` and
   exact `test-step` evidence mapping. Use `blocked` or `needs-review` when the
   contract cannot be completed.

## Forbidden Outputs

- No product source, product test, configuration, documentation, or repair
  mutation under any card wording.
- No new test target, environment, goal, gate, method, restart, or unbounded QA.
- No controller state, TODO, task-package, dispatch, or acceptance mutation.
- No target-to-target handoff or product-owner takeover.
- No secrets, private handles, raw local absolute paths, or unbounded logs in
  tracked evidence.

## Quality Bar

Every Test action answers one frozen controller question and maps to one
approved plan item. Evidence must distinguish observation from inference and
state what the run cannot prove. Self-evidence review improves the return
material; only the controller independently validates it and decides
acceptance, rework, routing, or completion.
