# Plan Quality Standard

The primary product of this skill is a self-contained long-chain execution plan. The plan must be clear enough for another agent to execute node by node without rereading this skill.

When a target workflow already has a strong benchmark plan, use that document as the quality floor. A generated plan should improve it by combining source-derived boundaries, target-document requirements, branch impacts, isolation design, and execution handoff instructions in one place.

## Plan-First Contract

- Generate the plan before broad workflow execution.
- Treat code, tests, logs, and target documents as evidence sources for the plan, not as the plan itself.
- Do not include implementation snippets or repair code unless a symbol name is needed to identify a boundary.
- Cite source files, symbols, commands, reports, database tables, and artifact names only as provenance.
- A future executor should know exactly where to start, where to stop, what to inspect, how to decide pass/fail, and when to advance.

## Required Reader Outcomes

After reading the plan, an execution agent must know:

- What chain is being validated and which executor path is in scope.
- Which source-derived boundaries define the node cuts.
- Which reference documents or overlays were used as coverage oracles.
- Which branches, skip flags, degradation paths, async paths, and persistence boundaries can make later nodes inapplicable.
- The exact order for each workflow variant, such as cold-start order, rescan order, delivery order, or any other domain-specific branch.
- For every node: target, execution scope, node-specific design/test plan, stop condition, evidence, pass criteria, failure classes, first optimization action, recheck standard, and advance rule.
- For every node: a benchmark-style operational guidance block with goal, execution range, evidence checklist, pass standard, failure taxonomy, optimization actions, and recheck metrics.
- For every node: simulated input or frozen upstream artifact, downstream cut point, reset rule, and proof that downstream behavior did not make the node pass.
- For every node: a full section task workflow with intake, design, fixture setup, isolated execution, diagnosis, repair, rerun, hardening, and handoff.
- The current-node cursor, the smallest allowed action for that node, the forbidden broad commands, and the rule that only the current node may change status in one round.
- The terminal stability contract for each command: sync/async mode, timeout budget, non-interactive guarantee, output capture path, explicit exit evidence, and hang recovery.
- Which facts are source-derived, which are reference-derived, which are assumptions, and which remain open questions.
- Which benchmark requirements are covered, split, missing, conditional, or not applicable.
- Which focused tests or observation hooks already exist for each node, and which are missing.
- When metrics are in scope, which useful unit, quality gate, stage loss, baseline, candidate, comparison, and verdict belong to each evaluated node.

## Information Accuracy Rules

Label important claims with one of these evidence classes:

- `source`: confirmed by code, tests, routes, handlers, commands, or observed artifacts.
- `reference`: required by target documents, bug reports, overlays, or user instructions.
- `observed`: confirmed by a previous real run, harness, log, DB snapshot, report, or command output.
- `assumption`: reasonable but not yet proven; must have a validation step.
- `open`: missing fact that blocks execution or requires a separate observation node.

Do not let a reference claim pass a node. References can raise the bar, reveal missing coverage, or name the node; source or observed evidence proves behavior.

## Node Cut Algorithm

Use this sequence when turning a workflow into plan sections:

1. Name the workflow variants and executor scope.
2. Identify the earliest safe entry point for each variant.
3. Follow the chain until the first visible artifact, side effect, async boundary, persistence boundary, model/agent boundary, delivery boundary, or report/history boundary.
4. Create a node when the boundary can fail, skip, degrade, write, dispatch, persist, or produce a dependent artifact independently.
5. Split branches where a successful command can hide skipped downstream behavior.
6. Align the node list against target documents and overlays.
7. Render every selected node as a full node section, not just a table row.
8. For every selected node, design node-local fixture data, upstream freeze, downstream cut, reset rule, and isolation proof.
9. For every selected node, define the section task workflow from intake through handoff.
10. Mark reference nodes that are source-excluded as `not-applicable`, and source-dependent nodes as `conditional`.
11. Add variant-specific execution orders and full-run readiness gates.
12. Add expansion nodes when the plan must grow from focused scope to full scope.

## Execution Control Gate

A generated plan must make execution slow by default. It is incomplete if an execution agent can reasonably interpret it as permission to run the whole workflow and sort out node statuses afterward.

Required execution controls:

- Declare the next node cursor and say that only this node may change status in the next round.
- Declare the current section phase and the completion criteria for that phase.
- Require every node to contain its own design/test plan, and execute that subplan as a whole before marking the node pass.
- Require every node to be independently verifiable with simulated data, frozen upstream artifacts, or a focused harness.
- For each node, name the smallest allowed command, test, harness, or inspection that reaches the node stop condition.
- For each node, name the downstream cut point, reset rule, and isolation proof.
- For each node, name command shapes that are forbidden before the node passes, especially full async runs, delivery/finalizer commands, production writes, and broad expansion runs.
- For each terminal command, require bounded execution. The plan must reject unbounded synchronous commands, missing exit evidence, hidden interactive prompts, and bulky output without an attachment policy.
- If a command cannot stop at the node and will run farther, mark it as an observation transport. It can collect evidence, but it cannot pass downstream nodes and must not be used when it can cross an unapproved write boundary.
- Before a full end-to-end confirmation run, require all prerequisite component nodes for that variant to be `pass` or explicitly `skipped` with downstream impact recorded.
- When a node fails, require repair or observability improvement for that node, then rerun the same node before any later node starts.
- Treat a single node as a complete task. Do not treat moving to more nodes as progress when the current section still needs diagnosis, repair, rerun, or hardening.

## Required Node Section

Every generated node section must include these fields. Use the user's language for headings when possible.

```markdown
## Node Nx: <name>

Target:
This round validates the chain only from entry to Nx.

Chain position:
Upstream prerequisites, downstream nodes intentionally not evaluated, and variant applicability.

Execution scope:
Entry, input shape, dimensions, limits, provider mode, wait mode, and branches to force or forbid.

Operational guidance:
Goal, execution range, evidence checklist, pass standard, failure taxonomy, optimization actions, and recheck metrics. The checklist must name concrete fields, counts, artifacts, tool calls, rejected reasons, duplicate keys, source references, status rows, write-surface hashes, or logs. A future executor should be able to diagnose and repair this node from this block alone.

Node design/test plan:
The node's mini-plan: setup, fixtures or state, simulated data or frozen upstream artifact, upstream freeze rule, downstream cut point, reset rule, commands or harnesses, observability, expected artifacts, assertions, negative cases, repair target, and same-node rerun rule. This subplan is the unit of validation for the node.

Section task workflow:
The current node's full lifecycle: intake, design, fixture setup, isolated execution, diagnosis, repair, same-node rerun, hardening, and handoff. The executor may spend the whole turn on this section.

Isolation design:
How upstream behavior is simulated or frozen, how downstream behavior is blocked or made observation-only, how async scheduling/workers/timers are controlled, how shared state is reset, and how evidence proves later nodes did not affect this node's decision.

Allowed action:
The smallest command, test, harness, or inspection that may be run for this node.

Forbidden broad actions:
Commands or modes that would cross downstream nodes, write outside the boundary, or hide failures before this node passes.

Terminal stability:
Sync or async mode, timeout budget, expected duration, output policy, explicit exit marker or test summary, non-interactive guarantees, and what to do if the command stalls or is cancelled.

Existing tests or observation gap:
Focused tests, harnesses, report fields, logs, or the first observation hook needed before repair.

Stop condition:
The exact observable point where the executor must stop judging this round.

Evidence:
Logs, reports, DB tables, JSON files, snapshots, task status, generated artifacts, or command output to inspect.

Pass criteria:
Concrete invariants that must hold.

Failure classes:
Input, state, algorithm, async, concurrency, persistence, external service, model/agent, delivery, report/history, or observability.

First optimization action:
The smallest observability or behavior change to try first when the node fails.

Recheck standard:
Same entry, same data, same target node; compare before/after evidence and metric changes.

Metrics contract:
Useful unit, quality gate, stage loss, baseline, candidate, comparison, verdict, evidence links, and residual risk when baseline, scorecard, comparison, optimization, or quality measurement is in scope. Improvement counts only after the quality gate passes. If artifacts, traces, metrics, or source references cannot be linked to the node, verdict is `blocked-by-observability-gap`.

Advance rule:
What allows the next node to start, and what blocks it.
```

## Completeness Gate

A plan is incomplete when any of these are true:

- It contains only a node table and no expanded per-node sections.
- Expanded node sections lack a node-specific design/test plan.
- Expanded node sections lack benchmark-style operational guidance with concrete evidence checklist, failure taxonomy, optimization actions, and recheck metrics.
- Expanded node sections lack node-local simulated data or frozen upstream artifacts.
- Expanded node sections lack downstream cut points, reset rules, or isolation proof.
- Expanded node sections lack a section task workflow from intake through handoff.
- It uses one smoke or end-to-end command as the execution plan.
- It has fewer than 10 nodes for a multi-boundary long chain without explaining why boundaries cannot be split.
- It omits branch or degradation impacts for skip flags, async dispatch, unavailable services, mock mode, cancellation, or alternate executor routes.
- It lacks variant orders for workflows that differ by mode, such as cold-start versus rescan.
- It has an async workflow but does not distinguish skeleton-only observation from full async execution.
- It has an async workflow but does not split scheduler, worker, producer, persistence, finalizer, delivery, and report/history boundaries when they can fail independently.
- It allows a full async or end-to-end command before the relevant component nodes have passed, unless that command is explicitly marked observation-only and safe for the declared write boundary.
- It allows unbounded synchronous terminal execution, omits timeout budgets, omits non-interactive prompt prevention, omits exit evidence, or lacks a hang recovery rule.
- It does not declare the current-node cursor, forbidden broad actions, and one-node-only status transition rule.
- It omits expansion nodes for moving from focused validation to full scope.
- It omits node-to-test or node-to-observation coverage.
- It does not state full-run readiness criteria.
- It rewards finishing many nodes over making the current node trustworthy, repaired, rerun, and handed off.
- It leaves pass criteria as vague phrases like "works", "success", or "no error" without concrete evidence.
- It leaves evidence as generic artifacts without naming the fields, counts, rejected reasons, duplicate keys, tool calls, source refs, or write-surface proofs that decide the node.
- It claims baseline improvement while the node quality gate is failed, blocked, fallback-only, or missing node-linked artifact / trace / metric evidence.

## Better-Than-Reference Requirement

When a target document already has a useful plan, the generated plan must preserve that structure and add:

- Source-derived provenance for each node cut.
- Branch and degradation impact for each node.
- Evidence class labels for important claims.
- Stop condition and intentionally not evaluated downstream behavior for each node.
- A node-specific design/test plan for each node, so every section can be verified independently as a coherent subplan.
- Per-node fixture data, upstream freeze, downstream cut, async controls, reset rule, and isolation proof.
- A per-node section workflow that makes patient diagnosis, repair, rerun, hardening, and handoff mandatory.
- First optimization action and recheck standard for each node.
- A preserved and source-aligned version of the strongest benchmark node checklists, including concrete evidence, pass standards, failure classification, optimization actions, and recheck metrics.
- Variant-specific order and expansion strategy.
- Full-run readiness gate and residual-risk list.
- Explicit `not-applicable` and `conditional` decisions for reference nodes outside the selected source path.
- A benchmark review artifact recording any Skill/template/overlay changes discovered by the run.

## Benchmark Review Requirement

After writing `report/plan.md`, complete its benchmark review section. The review must compare the generated plan with the strongest target reference, preserve the reference's useful structure, explain where the generated plan improves it, list any benchmark gaps still missing, and name any Skill, template, or overlay changes discovered by the run.
