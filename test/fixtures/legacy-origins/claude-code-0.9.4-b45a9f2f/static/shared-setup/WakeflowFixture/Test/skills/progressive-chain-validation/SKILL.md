---
name: progressive-chain-validation
description: Use when the Test window needs a source-derived chain plan, node-by-node validation, isolated repair evidence, scoped round verdicts, before/after metrics, or a progressive validation plan for a long workflow.
---

# Progressive Chain Validation

Use this Test-window skill to turn a long workflow into a source-derived
execution plan, then validate or repair that workflow one node at a time.

This is a general Test skill. Product-specific adapters, overlays, examples,
and repository names belong in the installed workspace or product repository,
not in Wakeflow's reusable template.

## Required Inputs

Before acting, identify:

- target workflow or feature chain;
- target project root, external test project, or sandbox copy;
- whether the request is plan-only, plan-then-execute, repair, review, or
  metrics comparison;
- existing requirement design, test card, failing output, benchmark reference,
  trace, report, or user scenario;
- allowed command scope, write boundary, and destructive-operation boundary;
- entry hints, relevant documents, existing tests, observability surfaces, and
  runtime data locations;
- desired useful units, baseline references, comparison fixtures, scorecard
  fields, or metric gates when metrics are in scope;
- executor scope such as CLI, API route, MCP handler, dashboard, internal
  agent, external agent, worker, service, or mixed;
- current node or round when resuming;
- per-node isolation constraints: simulated data, frozen upstream artifacts,
  downstream cut points, async controls, and reset requirements;
- terminal stability constraints: timeout budget, sync versus async mode,
  output capture path, exit evidence, and hang recovery rule.

If any command may write runtime data, generated project assets, database files,
reports, delivery output, project skills, IDE integration files, or
user-global configuration, first complete `N0-data-location` from
[Data Location Preflight](references/data-location-preflight.md).

## Startup

1. Load [Safety Boundaries](references/safety-boundaries.md) before planning
   commands.
2. Load [Data Location Preflight](references/data-location-preflight.md) before
   any runtime, database, generated artifact, delivery, or integration write.
3. Load [Plan Quality Standard](references/plan-quality-standard.md) before
   writing `report/plan.md`.
4. Load [Chain Plan Generation](references/chain-plan-generation.md) before
   creating the node list.
5. Load [Metrics Contract](references/metrics-contract.md) when the run needs
   baseline, scorecard, comparison, verdict, optimization, or quality
   measurement fields.
6. Load [Round Model](references/round-model.md) when work needs staged
   evidence scopes, scoped verdicts, or later expansion rounds.
7. Load [Local Chain Optimization](references/local-chain-optimization.md) when
   validating or improving one producer/consumer segment.
8. Build a source chain map before applying any target document, benchmark, or
   workspace-specific overlay.
9. Create a run id with the `pcv-YYYYMMDD-HHMM-<target-slug>` pattern.
10. Use [Artifact Layout](references/artifact-layout.md). `report/plan.md` is
    the single required run artifact.
11. Initialize the run with [Plan Template](templates/plan.md). Add extra files
    only when evidence is too large, binary, or machine-generated.

## Primary Deliverable

The required first output is:

```text
scratch/chain-runs/<run-id>/report/plan.md
```

When the user or controller asks for a plan only, stop after producing and
reviewing the plan. Do not run broad workflow commands just to make the plan
look complete.

When execution is authorized, treat `report/plan.md` as the state machine:

- start at the first non-terminal node;
- execute only that node's smallest safe action;
- update only that node's section and the execution log;
- advance only after that node passes on its own evidence.

Every node must include target, chain position, execution scope, operational
guidance, node-specific design/test plan, stop condition, evidence, pass
criteria, failure classes, first optimization action, recheck standard, and
advance rule.

When metrics are in scope, every evaluated node must also include useful unit,
quality gate, stage loss, baseline/candidate/comparison fields as applicable,
and a scoped verdict. Quality gates must pass before loss improvement can
count. If required artifacts, traces, metrics, or source references cannot be
linked to the node, use `blocked-by-observability-gap` instead of inventing a
score.

## Source-Derived Planning

Generate the node plan from source boundaries before applying target documents
or benchmarks.

1. Locate entry points from code, tests, routes, commands, handlers, jobs, UI
   actions, or failing outputs.
2. Follow the call path until externally visible artifacts, side effects,
   async boundaries, persistence boundaries, model/agent calls, delivery, or
   reports.
3. Record entry points, call path, state boundaries, side effects, artifacts,
   existing tests, observability gaps, and proposed nodes in the plan's Source
   Chain Map.
4. Record branch and degradation paths, including skip flags, async dispatch,
   unavailable services, mock modes, cancellation, and alternate routes.
5. Derive nodes from real boundaries. Each node needs a stop condition,
   evidence surface, pass criteria, failure classes, first repair target,
   fixture, and isolation cut.
6. Compare derived nodes with requirement designs, test cards, and benchmarks
   as `covered`, `split`, `merged`, `missing`, `not-applicable`, or
   `conditional`.
7. Render a complete human-readable plan from the chain map and alignment. The
   plan must be executable without rereading this skill.
8. For async workflows, split scheduler, worker/start, producer, persistence,
   finalizer, delivery, report/history, and cleanup unless source evidence
   proves two boundaries cannot be cut apart.

## Node Contract

Every node must have:

- a stable id such as `N0-data-location`, `N1-entry-model`, or
  `N2-focused-test`;
- a falsifiable hypothesis;
- node-local input: simulated data, fixture state, frozen upstream artifact, or
  read-only source fact;
- upstream freeze rule and downstream cut point;
- isolation mechanism: mock, stub, fake service, injected dependency,
  temporary harness, dry-run, scheduler pause, transaction rollback, isolated
  data root, or read-only inspection;
- reset rule for files, database rows, process state, queues, timers, caches,
  sessions, and environment variables;
- isolation proof that downstream artifacts are absent, unchanged, skipped, or
  observation-only;
- bounded command plan with timeout, non-interactive guarantee, expected output,
  exit evidence, and hang recovery;
- pass criteria from files, command output, structured evidence, logs,
  artifacts, or tests;
- failure policy: retry, repair current node, split node, block, or stop;
- status from `pending`, `running`, `pass`, `fail`, `blocked`, or `skipped`.

## Execution Control

Execution is a current-node driver, not a smoke test.

- Only the current node may change from `pending` or `running` to a terminal
  status in one execution round.
- A broad command that crosses pending downstream nodes is observation-only for
  those nodes.
- If a command reveals the first failed invariant, stop, record the failure,
  repair the current node if allowed, rerun the same node, then decide whether
  to advance.
- If no command can stop at the current boundary, create or repair
  observability before running the full chain.
- Full end-to-end runs are confirmation runs after prerequisite component nodes
  pass.
- Never run unbounded synchronous terminal commands.
- Do not write final outcome as a substitute for repairing a failed current
  node.

## Work Loop

For the current node:

1. Intake: restate target, prerequisites, downstream block, and write boundary.
2. Design: choose fixture, upstream freeze, downstream cut, assertions,
   negative case, and repair target.
3. Execute: run the smallest action that proves or falsifies the node.
4. Diagnose: compare evidence with pass and isolation criteria.
5. Repair: change only current-node behavior, fixture, observability, or
   testability.
6. Rerun: repeat the same subplan and record before/after evidence.
7. Harden: add focused tests or guards when behavior is reusable.
8. Handoff: update the node with decision, residual risk, and advance rule.

## Test Window Boundaries

- Test may produce PCV plans, focused harnesses, evidence records, and scoped
  verdicts when assigned by a controller state root or test card.
- Test does not accept product work, dispatch implementation windows, mutate
  controller state, or declare final product acceptance.
- Product source edits are allowed only when the controller explicitly assigns
  that repair to Test and the target repository rules permit it; otherwise Test
  returns a repair package to the owning product window.
- Real project, runtime, dashboard, delivery, live provider, or integration
  evidence must name what success proves, what failure proves, what it cannot
  prove, and the stop condition.

## References

- [Safety Boundaries](references/safety-boundaries.md)
- [Artifact Layout](references/artifact-layout.md)
- [Data Location Preflight](references/data-location-preflight.md)
- [Plan Quality Standard](references/plan-quality-standard.md)
- [Chain Plan Generation](references/chain-plan-generation.md)
- [Metrics Contract](references/metrics-contract.md)
- [Round Model](references/round-model.md)
- [Local Chain Optimization](references/local-chain-optimization.md)
- [Plan Template](templates/plan.md)
