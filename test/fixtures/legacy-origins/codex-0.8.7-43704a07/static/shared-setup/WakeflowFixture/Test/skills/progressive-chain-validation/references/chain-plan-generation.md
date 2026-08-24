# Chain Plan Generation

Use this reference before writing the node plan. The plan must come from the code path first and must render as a self-contained execution document. Target documents, bug reports, and selected domain overlays are coverage references, not replacements for source analysis.

## Source-First Rule

Generate a chain map before running a broad workflow command. A valid plan records what the code actually does, where it can stop, what proves each stop, and which repair target owns the first failing invariant.

If the source path is unclear, do one of these before executing a broad command:

- Add a read-only exploration node that identifies the missing entry, state transition, or artifact producer.
- Add observability to the current boundary, such as a focused test hook, report field, debug summary, or structured evidence artifact.
- Mark the node blocked with the missing fact and do not invent a later node from a reference document alone.

## Analysis Passes

1. Entry pass: identify CLI commands, HTTP routes, MCP handlers, Dashboard actions, service methods, scheduled tasks, test harnesses, or agent tool entry points.
2. Call-path pass: follow imports, method calls, dependency injection, task scheduling, and event dispatch until the chain reaches visible outputs.
3. State pass: list input normalization, intent construction, config/default resolution, registry reads, cache reads, task/session state, and cancellation state.
4. Side-effect pass: list filesystem writes, database writes, external model calls, terminal/tool calls, network/service calls, and process lifecycle operations.
5. Executor pass: distinguish public tools from internal handlers and internal-agent from external-agent execution. Do not validate one executor by accidentally running another.
6. Branch pass: list skip flags, async dispatch branches, cancellation paths, unavailable external services, mock modes, retries, and graceful degradation paths.
7. Artifact pass: list logs, JSON reports, DB rows, snapshots, task status, candidate files, generated documentation, delivery output, and terminal artifacts.
8. Test pass: list existing tests and the exact boundary they prove. If no focused test exists, record the gap before long-chain execution.
9. Observability pass: identify boundaries where failure would be ambiguous and plan the first evidence hook.
10. Isolation pass: for every proposed node, design node-local simulated data or frozen upstream artifacts, the downstream cut point, reset rules, and proof that later nodes did not execute or did not affect the decision.
11. Terminal stability pass: for every command candidate, decide sync versus async, timeout budget, non-interactive flags, output capture, exit marker, and hang recovery before it appears in the plan.
12. Guidance pass: for every proposed node, synthesize a benchmark-style operational block from source evidence, target documents, overlays, tests, and observed artifacts. This block must name the goal, execution range, evidence checklist, pass standard, failure taxonomy, optimization actions, and recheck metrics.
13. Section workflow pass: for every proposed node, define the intake, design, fixture setup, execution, diagnosis, repair, rerun, hardening, and handoff phases.

## Node Derivation Rules

Create a node when a boundary has at least one of these properties:

- It changes the semantic input model, such as parsing request options into an intent.
- It changes durable or cross-stage state, such as DB records, task/session state, snapshots, or caches.
- It changes the execution surface, such as selecting dimensions, stages, tools, providers, or concurrency.
- It performs a side effect, such as file writes, database writes, terminal usage, model calls, delivery output, or cleanup.
- It creates an artifact that later stages depend on, such as analysis output, quality-gate artifacts, candidates, reports, or history.
- It crosses an async, cancellation, transaction, process, or external-service boundary.
- It is a known defect boundary from a bug report, failing output, or previous round.
- It has a branch or degradation path where the workflow can return success, skip work, or degrade while later nodes would not actually run.

A node must not be only a filename or phase label. It needs a node-specific design/test plan, node-local fixture, isolation cut, stop condition, evidence surface, benchmark-style guidance, pass criteria, likely failure classes, first repair target, recheck standard, and advance rule.

Benchmark-style guidance means the node section answers the same practical questions as a strong manual test plan: what is the goal, how far may execution advance, what exact evidence is checked, what concrete pass standards apply, how failures are classified, what to optimize first, and how the same input is rechecked after repair. Preserve useful target-document checklists, but source-align every item to the real code boundary.

A node is also a complete task section. It is incomplete if it only says what command to run and what result to expect; it must say how to diagnose, repair, rerun, harden, and hand off the section when the first attempt is not good enough.

## Node Isolation Design

Each node is valid only when it can be proven independently of later nodes. Build the isolation design before selecting commands.

For every node, record:

- Simulated input, fixture state, or frozen upstream artifact that represents the node prerequisites.
- Upstream freeze rule: which prior facts are trusted and how they remain stable during reruns.
- Downstream cut point: the first function call, scheduled task, event, process, database write, file write, model/tool call, delivery step, or report producer that must not run for this node's pass decision.
- Isolation mechanism: fake dependency, mock service, stubbed producer/consumer, dry-run/no-delivery flag, transaction rollback, isolated data root, scheduler pause, timer control, cancellation hook, or read-only inspection.
- Reset rule for files, DB rows, caches, sessions, queues, environment variables, timers, and temp roots.
- Isolation proof: downstream artifacts absent, unchanged, skipped, rolled back, or marked observation-only.

If a node cannot be cut away from a later boundary, it is not ready for execution. Add a testability or observability repair for the current node instead of running the whole chain. A broad command may collect observation evidence only after the write boundary is safe, and it cannot pass downstream nodes.

For async flows, split enqueue/schedule, worker claim, preparation, producer/model/tool execution, persistence consumer, finalizer, delivery, generated documentation, report/history, and semantic memory when those stages have different owners, artifacts, retries, or write surfaces. A `wait` mode proves only the final confirmation node unless each component node has already passed with its own fixture and cut.

## Granularity Rules

- Split before and after irreversible writes, cleanup, delivery, or destructive operations.
- Split before and after model/agent execution when the producer of structured evidence differs from the consumer.
- Split before and after async scheduling when status, cancellation, or retry behavior can diverge from execution.
- Split executor-scope changes, such as public MCP tools versus internal handlers, when they route to different workflow implementations.
- Split branch and degradation paths when a skip, mock, unavailable service, or fire-and-forget dispatch can make later nodes inapplicable.
- Split broad phases when one command success could hide multiple independent invariants.
- Split any node whose pass evidence requires live execution of a later pending node. Replace that dependency with a frozen artifact, fake, stub, or focused harness.
- Merge only when two adjacent boundaries always fail and repair together, share evidence, and cannot be stopped independently.
- Long chains normally need 10 or more nodes before any full run.

## Reference Alignment

After deriving nodes from code, compare them with target documents and selected domain overlays.

For each reference node or requirement, record one status:

- `covered`: one derived node directly proves it.
- `split`: several smaller derived nodes prove it.
- `merged`: the source code has a combined boundary; explain why it cannot be split yet.
- `missing`: the code-derived plan lacks coverage and must add a node, test, or observability step.
- `not-applicable`: the reference requirement does not apply to this target chain; record the reason.
- `conditional`: the requirement applies only under a branch, executor, fixture state, provider mode, or expansion step; record the condition.

Use reference alignment to fill gaps in the plan. Do not mark a derived node as passed until its own source evidence satisfies its pass criteria.

## Repair Loop Standard

Every node follows the same repair loop:

1. Intake: restate the node target, prerequisites, blocked downstream behavior, and write boundary.
2. Design: write or update the node-specific design/test plan, including simulated data, upstream freeze rule, downstream cut, reset rule, and isolation proof.
3. Execute: run or inspect only enough to complete that node subplan and reach the target node.
4. Diagnose: collect evidence and decide pass/fail using explicit invariants.
5. Observe: if the reason is unclear, improve observability before changing behavior.
6. Repair: if behavior is wrong, repair the current node only.
7. Harden: add or update a focused lower-level test when the behavior is reusable.
8. Rerun: repeat the same node subplan with the same input and compare before/after evidence.
9. Handoff: update the section with decision, residual risk, and the exact next-node advance rule.
10. Advance only when the current node's subplan passes as a whole.

Do not continue from a failed node to a later node in the same execution turn. Do not produce a final report instead of repairing when the requested scope includes repair and the next repair target is clear.

Patience rule: the correct unit of progress is one section becoming trustworthy. It is acceptable to stop after one repaired node. It is not acceptable to rush into later nodes because the plan contains many pending rows.

## Strict Execution Driver

The plan executor must hold a single current-node cursor.

- At the start of each round, read the Node Plan and Execution Log sections in `report/plan.md`, then select the first non-terminal node for the chosen variant.
- Update the current node section inside `report/plan.md` before running commands, including the node design/test plan, allowed action, forbidden broad actions, expected write surfaces, and stop condition.
- Record the current section phase and complete that phase before changing tools or moving the cursor.
- Confirm the node-local fixture and downstream cut before running commands. If the cut is missing, repair observability or testability for the current node first.
- Execute the smallest action that can prove or falsify the current node.
- Run terminal actions with a bounded timeout or async readiness/finish signal, concise output policy, non-interactive flags, and explicit exit evidence. Never make an unbounded synchronous terminal command the first proof for a node.
- Update only the current node's status after the action.
- If a broad command is unavoidable because source code has no stop point, mark it observation-only, verify it is safe for the write boundary, and leave downstream node statuses unchanged.
- If a broad command reveals a downstream defect, stop at the earliest source boundary that allowed the defect, record a failed node there, repair that boundary, and rerun the same node.
- Full workflow commands are confirmation gates after component nodes pass; they are not the primary validation method.
- If a command stalls, times out, or is cancelled, stop the current node. Record partial output, classify the hang as an observability or execution failure, and split or repair the harness before rerunning the same node.

## Required Outputs

Write `report/plan.md` before executing a broad workflow command. It is the single required artifact and must include:

- Structured source-derived chain analysis.
- Source narrative, node cut strategy, variant orders, expanded node sections, branch impacts, repair policy, and full-run readiness gate.
- Reference alignment against target documents and selected domain overlays.
- Benchmark review and feedback on Skill/template/overlay gaps discovered by the generated plan.
- Node status table and transition rules.
- Execution cursor, one-node-only transition rule, per-node design/test plan, per-node allowed action, per-node forbidden broad actions, and full-run readiness criteria.
- Terminal stability plan for each terminal command: sync/async mode, timeout budget, exit marker, output capture, and hang recovery.
- Per-node simulated data or frozen upstream artifact, downstream cut point, reset rule, and isolation proof.
- Per-node benchmark-style operational guidance: goal, execution range, evidence checklist, pass standard, failure taxonomy, optimization actions, and recheck metrics.
- Per-node section workflow: intake, design, fixture setup, isolated execution, diagnosis, repair, rerun, hardening, and handoff.

Use optional attachments only for large command output, binary snapshots, generated JSON reports, or bulky machine output. Summarize every attachment in the relevant plan section.

Do not execute a broad workflow command while `report/plan.md` is still only a table or outline.

## Branch and Degradation Contract

For each branch or degradation path, record:

- Trigger: the flag, missing service, route, or runtime condition.
- Effect: which downstream nodes are skipped, blocked, degraded, or still valid.
- Evidence: the log, status, return field, or artifact that proves the branch taken.
- Decision: whether the branch can pass the current node, block later nodes, or requires a separate plan.

Examples include `skipAsyncFill`, fire-and-forget dispatch, cancellation, AI provider unavailable, mock provider mode, terminal toolset fallback, and public/internal handler route differences.
