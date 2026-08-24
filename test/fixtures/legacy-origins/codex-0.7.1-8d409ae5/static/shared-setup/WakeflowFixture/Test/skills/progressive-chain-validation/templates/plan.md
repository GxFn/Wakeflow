# Progressive Chain Execution Plan

Run ID: `<pcv-YYYYMMDD-HHMM-target-slug>`
Target: `<workflow-or-feature>`
Target project root: `<absolute-path-or-n/a>`
Data root: `<absolute-path-or-n/a>`
Owner: `<agent-or-person>`
Started at: `<iso-time>`

Status values: `pending`, `running`, `pass`, `fail`, `blocked`, `skipped`
Execution cursor: only the current node may change status in one round.

Primary deliverable: this document is the execution guide for a later agent. It must be self-contained, more explicit than the target reference document, and complete before broad workflow execution.

Minimum reference standard: `<benchmark-reference-or-n/a>`. When no benchmark exists, use the same clarity bar: clear method, node overview, per-node sections, variant orders, round protocol, isolation proof, and full-run readiness gate.

## Scope

Describe the workflow boundary, entry points, expected outputs, and what is intentionally out of scope.

Executor scope: `<internal-agent|external-agent|dashboard|cli|mcp-public|mcp-internal|mixed|unknown>`
Plan mode: `<plan-only|plan-then-execute>`
Output language: `<user-language-or-project-default>`

## Plan Quality Standard

- A future agent can execute the chain from this document without rereading the skill.
- Code and tests are evidence sources, not implementation instructions.
- Every important claim is labeled as `source`, `reference`, `observed`, `assumption`, or `open`.
- Every selected node has an expanded node section, not only a row in a table.
- Every expanded node has benchmark-style operational guidance: goal, execution range, evidence checklist, pass standard, failure taxonomy, optimization actions, and recheck metrics.
- Every expanded node has its own design/test plan and that subplan is the unit of validation.
- Every node has node-local simulated data or a frozen upstream artifact, a downstream cut point, a reset rule, and proof that downstream behavior did not pass the node by accident.
- Every node is treated as a complete section task with intake, design, fixture, execute, diagnose, repair, rerun, harden, and handoff phases.
- The plan names what each node intentionally does not evaluate.
- Branches, degraded paths, skip flags, async dispatch, cancellation, and alternate executor routes declare downstream impact.
- Workflow variants have explicit execution orders.
- The full-run readiness gate explains when a broad run is allowed.
- The plan includes a benchmark review and node-to-test coverage map before execution.
- Execution is one-node-at-a-time: a broad command cannot pass downstream nodes by returning success.
- Terminal execution is bounded: every command has sync/async mode, timeout budget, output policy, exit evidence, non-interactive guarantee, and hang recovery.

## Safety Boundary

- Repository under edit:
- External test project:
- Runtime data location:
- Commands allowed:
- Commands requiring approval:
- Destructive operations allowed: no, unless explicitly approved

## Evidence Schema

- Required artifact: this `report/plan.md` file.
- Source chain map: inline section below.
- Reference alignment: inline section below.
- Skill review: inline benchmark review section below.
- Metrics contract: inline node scorecards, baselines, comparisons, and verdict summary below when metrics are in scope.
- Node state and execution log: inline Node Plan and per-node sections below.
- Optional attachments: `attachments/<node-id>-<short-name>.<ext>` only when output is too large, binary, or machine-generated.
- Source changes and residual risk: inline final outcome section.

Attachment rule: every optional attachment must be summarized in the relevant plan section and must not become a second source of truth.

## Source-First Chain Analysis

Complete this section from code before executing a broad workflow command.

- Entry points: `<source|reference|observed|assumption|open>`
- Call path: `<source|reference|observed|assumption|open>`
- State boundaries: `<source|reference|observed|assumption|open>`
- Async/external/persistence boundaries: `<source|reference|observed|assumption|open>`
- Branches and degradation paths: `<source|reference|observed|assumption|open>`
- Side effects and write surfaces: `<source|reference|observed|assumption|open>`
- Artifact producers and consumers: `<source|reference|observed|assumption|open>`
- Existing focused tests: `<source|observed|open>`
- Observability gaps: `<source|observed|open>`
- Proposed stop conditions: `<source|reference|observed|assumption|open>`
- Node-local fixtures and isolation cuts: `<source|observed|assumption|open>`

## Source Chain Map

Keep the chain map here instead of a separate file.

| Order | From | To | File/Symbol | Boundary Type | Node Candidate |
|-------|------|----|-------------|---------------|----------------|
| `<n>` | `<entry>` | `<next>` | `<source-ref>` | `<state|async|persistence|delivery|report>` | `<node-id>` |

Side effects:

- `<effect>`

Artifacts:

- `<artifact>`

Observability gaps:

- `<gap>`

## Analysis Chain Narrative

Write the chain as a readable sequence before the node table. Explain how data, state, artifacts, and decisions move from entry to output. Keep this section free of repair code; cite files, symbols, reports, or artifact names only as provenance.

1. `<entry-or-trigger>` -> `<normalized-intent-or-input>`
2. `<state-or-materialization-boundary>` -> `<artifact-or-decision>`
3. `<async-agent-persistence-delivery-report-boundary>` -> `<visible-output>`

## Node Cut Strategy

Explain why each cut exists. A cut is valid when the boundary can stop, fail, skip, degrade, write, dispatch asynchronously, persist, call a model/agent, deliver output, or produce a dependent artifact independently.

| Cut | Evidence Class | Boundary | Why It Is A Separate Node | Node-Local Fixture | Downstream Cut | Merge/Split Decision |
|-----|----------------|----------|---------------------------|--------------------|----------------|----------------------|
| `<cut-id>` | `<source|reference|observed|assumption|open>` | `<boundary>` | `<reason>` | `<fixture-or-frozen-artifact>` | `<function-task-write-model-call-or-report-to-block>` | `<keep|split|merge|blocked>` |

## Granularity Gate

- Long-chain target: `<yes-or-no>`
- Source-first plan complete: `<yes-or-no>`
- Minimum nodes required: `10` when the chain crosses multiple independent runtime, async, persistence, Agent/model, delivery, or report boundaries
- Reference documents and selected domain overlays are coverage oracles, not substitutes for source analysis
- Domain overlay selected: `<none|overlay-id>`
- Overlay source: `<skill-reference|target-doc|bug-report|n/a>`
- Overlay alignment required before execution: `<yes-or-no>`
- Broad smoke/end-to-end command allowed before node plan: `no`
- Scope expansion rule: change only one variable at a time
- Status transition rule: only the current node may change status in the next execution round
- Broad command policy: blocked until prerequisite nodes pass; observation-only when no safer stop point exists
- Isolation rule: a node cannot pass through live downstream behavior; it needs a fixture, cut point, reset rule, and isolation proof
- Patience rule: the current section may consume the whole turn; do not start later nodes until the current section is repaired, rerun, and handed off

## Branch And Degradation Paths

| Branch | Boundary | Trigger | Effect | Evidence | Decision |
|--------|----------|---------|--------|----------|----------|
| `<branch-id>` | `<boundary-id>` | `<flag-route-state-or-condition>` | `<continue-skip-block-or-degrade>` | `<log-status-artifact-or-test>` | `<pass-current-node|block-later-nodes|separate-plan|required-observation>` |

Skipped, mocked, degraded, or alternate-route branches cannot pass downstream nodes unless that branch is the explicit target of the node plan.

## Execution Control Gate

This section controls how the plan may be executed. Fill it before any runtime command.

- Current node cursor: `<node-id>`
- Current section phase: `<intake|design|fixture|execute|diagnose|repair|rerun|harden|handoff>`
- Only this node may change status in the next round: `yes`
- Smallest allowed next action: `<command-test-harness-or-inspection>`
- Terminal mode and timeout budget: `<sync-with-hard-timeout|async-with-readiness-signal|not-a-terminal-action>`
- Terminal output policy: `<inline-summary|attachments/node-output.txt|n/a>`
- Terminal exit evidence: `<test-summary|explicit-exit-marker|n/a>`
- Terminal non-interactive guarantee: `<flags-env-or-n/a>`
- Terminal hang recovery: `<kill-or-stop-terminal; record-partial-output; mark-current-node-blocked-or-fail; design-smaller-harness>`
- Forbidden broad actions before current node passes: `<full-run-delivery-expansion-or-other>`
- Node-local fixture or frozen upstream artifact:
- Downstream cut point for the next action:
- Reset rule before rerun:
- Isolation proof required:
- Can the next action physically cross downstream nodes: `<no|yes-observation-only>`
- If yes, why no safer stop point exists:
- Downstream output status if produced early: `observation-only, leave node statuses pending`
- Write surfaces allowed for the next action:
- Write surfaces requiring approval or a dry-run/no-delivery guard:
- Failure behavior: stop, repair current node, rerun current node, then advance
- Section completion behavior: finish the current node's task workflow before moving the cursor
- Full-run confirmation allowed only after:

## Workflow Variant Orders

Define every execution order that a future agent may follow. Do not assume one canonical order when modes differ.

For async workflows that return before background work completes, include at least:

- Skeleton-only observation variant.
- Full async execution variant.
- Expansion variant from focused scope to full scope.

### Variant A: `<variant-name>`

1. `<node-id>`: `<why-this-node-is-first>`
2. `<node-id>`: `<advance-condition>`

### Variant B: `<variant-name-or-n/a>`

1. `<node-id>`: `<why-this-node-is-first>`
2. `<node-id>`: `<advance-condition>`

## Reference Alignment

Compare the source-derived plan with target documents and domain overlays before executing the chain.

| Reference | Requirement | Derived Node | Status | Action |
|-----------|-------------|--------------|--------|--------|
| `<doc-or-protocol>` | `<node-or-requirement>` | `<node-id-or-n/a>` | `<covered|split|merged|missing|not-applicable|conditional>` | `<action>` |

## Reference Benchmark Review

Compare this generated plan with the strongest target reference before handing it to an execution agent.

- Benchmark reference:
- Meets or exceeds benchmark clarity: `<yes|no|partial>`
- Improvements over benchmark:
- Benchmark gaps still missing:
- Skill/template/overlay improvements discovered:

Keep the detailed review in this section. Do not create a separate review file unless explicitly requested.

## Node-To-Test Coverage Map

Before repair execution, map every node to existing focused tests or observation hooks.

| Node | Existing Test Or Observation | Missing Coverage | First Coverage Action |
|------|------------------------------|------------------|-----------------------|
| `<node-id>` | `<test-file-or-artifact-or-none>` | `<gap>` | `<test-or-observation-action>` |

## Per-Node Design/Test Plan Index

Every node must have a self-contained subplan before execution. The node cannot pass until this subplan is completed and its assertions hold.

| Node | Subplan Location | Section Phase | Setup/Fixture | Downstream Cut | Primary Assertion | Negative/Boundary Check | Rerun Rule |
|------|------------------|---------------|---------------|----------------|-------------------|-------------------------|------------|
| `<node-id>` | `this plan: Node <id>` | `<phase>` | `<state-or-frozen-artifact>` | `<blocked-function-task-write-or-report>` | `<invariant>` | `<negative-case-or-boundary>` | `rerun same node subplan before advancing` |

## Node Plan

| Node | Source Boundary | Purpose | Stop Condition | Evidence | Pass Criteria | Status |
|------|-----------------|---------|----------------|----------|---------------|--------|
| N0-data-location | write boundary | Confirm project/data paths | no runtime command has run | inline N0 path table or linked attachment | Paths are explicit and safe | pending |

Derive this table from source first, then align it to any selected overlay before running the chain. Do not leave the plan at N0/N1 plus one broad smoke node. After filling the table, render every selected node again as a full section below.

## Expanded Node Sections

Every long-chain node must use this expanded structure. Keep the wording concrete enough that another agent can execute the node without asking what to inspect.

### Node `<Nx-node-id>`: `<node-name>`

Target:
This round validates the chain only from entry to `<Nx-node-id>`.

Chain position:
- Upstream prerequisites:
- Downstream behavior intentionally not evaluated:
- Workflow variants where this node applies:
- Evidence class for this node cut: `<source|reference|observed|assumption|open>`

Execution scope:
- Entry:
- Input shape:
- Limits and dimensions:
- Provider/tool/wait mode:
- Branches to force or forbid:
- Safe write boundary:

Operational guidance:
- Goal:
- Execution range:
- Evidence checklist:
	- `<field-count-artifact-tool-call-source-ref-status-or-hash>`
- Pass standard:
	- `<concrete invariant, not just success/no error>`
- Failure taxonomy:
	- `<input|state|schema|dedup|budget|tool-policy|async|persistence|delivery|observability|other>`
- Optimization actions:
	- `<first prompt-schema-dedup-routing-persistence-observability-or-testability change>`
- Recheck metrics:
	- `<same fixture/artifact before-vs-after metric, such as accepted ratio, rejected reason quality, duplicate count, write-surface hash, or task status>`
- What this node intentionally does not prove:

Node design/test plan:
- Purpose of this node subplan:
- Section task workflow:
	- Intake:
	- Design:
	- Fixture setup:
	- Isolated execution:
	- Diagnosis:
	- Repair, if needed:
	- Same-node rerun:
	- Hardening:
	- Handoff:
- Setup and fixtures/state:
- Simulated data or frozen upstream artifact:
- Upstream freeze rule:
- Downstream cut point:
- Reset rule for rerun:
- Commands, harnesses, or inspections:
- Terminal stability plan for commands:
	- Mode and timeout budget:
	- Expected duration:
	- Output capture:
	- Exit marker or test summary:
	- Non-interactive flags/env:
	- Hang recovery:
- Observability hooks and evidence to collect:
- Expected artifacts:
- Positive assertions:
- Negative or boundary assertions:
- Isolation proof:
- Repair target if assertions fail:
- Same-node rerun rule:

Isolation design:
- Upstream behavior replaced by fixture, fake, frozen artifact, or read-only fact:
- Downstream behavior blocked, stubbed, skipped, rolled back, or left observation-only:
- Async controls, if applicable: scheduler pause, worker claim stub, queue fixture, timer control, cancellation handle, or no-wait/no-delivery guard:
- Shared state reset: files, database rows, caches, env vars, sessions, queues, timers, and temp roots:
- Evidence that later nodes did not execute or did not affect this node's pass decision:

Metrics contract:
- Useful unit:
- Quality gate:
	- Status: `<pass|fail|blocked|n/a>`
	- Invariants:
		- `<invariant>`
- Stage loss:
	- `<metric-or-categorical-loss>`:
- Baseline:
	- Fixture id:
	- Evidence links:
	- Stage loss:
- Candidate:
	- Fixture id:
	- Evidence links:
	- Stage loss:
- Comparison:
	- Quality gate baseline/candidate:
	- Stage loss delta:
	- Unchanged boundaries:
	- Rationale:
- Verdict: `<pass|regression|improved|neutral|blocked|blocked-by-observability-gap>`
- Observability gap, if blocked:
	- Missing link:
	- Expected evidence:
	- Observed evidence:
	- First fix:

Allowed action:
- Smallest command, test, harness, or inspection:
- Terminal execution guard: bounded timeout or async readiness signal; no unbounded `timeout=0`-style waits:

Forbidden broad actions:
- Commands or modes that would cross downstream nodes before this node passes:
- Commands or modes that would write outside the approved boundary:
- Async wait, full-run, delivery, report, or expansion modes forbidden until this node passes:

Existing tests or observation gap:
- Focused tests:
- Missing tests:
- First observation hook:

Stop condition:
- `<exact observable stop point>`

Evidence:
- `<log-report-db-json-snapshot-task-artifact-or-command-output>`

Execution log:
- Attempt:
- Section phase:
- Action:
- Terminal stability result:
- Output summary:
- Diagnosis:
- Repair or hardening:
- Same-node rerun result:
- Decision:
- Attachments, if any:

Pass criteria:
- `<concrete invariant>`
- Isolation criteria: downstream artifacts are absent, unchanged, skipped, rolled back, or explicitly observation-only.

Failure classes:
- `<input|state|algorithm|async|concurrency|persistence|external-service|model-agent|delivery|report-history|observability>`

First optimization action:
- `<smallest observation or behavior change to try first>`

Recheck standard:
- Same entry, same data, same target node.
- Compare before/after evidence.
- Record whether the next node may start.

Advance rule:
- Advance when:
- Block when:
- Split when:
- Stay on this node when:

## Repair Policy

- Fix only the current failing node.
- Treat the current node as the whole task until it is repaired, rerun, hardened where useful, and handed off.
- Re-run the same node before advancing.
- Do not advance to a later node or final report when the current failed node has an actionable repair.
- Do not start later nodes just to create momentum; progress is measured by current-section quality.
- If a command accidentally crosses downstream nodes, keep downstream statuses pending and record the output as observation-only.
- Split the node if the failure mixes unrelated modules.
- Record why if the repair scope expands.

## Risks

- `<risk>`

## Full-Run Readiness Gate

A broad workflow run is allowed only after these conditions are true:

- All prerequisite nodes for the selected variant are `pass` or explicitly `skipped` with downstream impact explained.
- The current-node cursor has reached a confirmation or expansion node.
- Delivery, generated documentation, agent instructions, candidate artifacts, database, integration, runtime, and source-root write surfaces are proven safe, dry-run/no-delivery, isolated, or explicitly approved.
- No important claim remains `open` for the selected variant.
- Branch and degradation impacts are recorded.
- Persistence, async, Agent/model, delivery, and report/history boundaries have their own evidence.
- Async component nodes have independent fixtures and cuts for scheduling, worker execution, producer/model/tool output, persistence, finalizer, delivery, and report/history.
- The planned expansion changes only one variable at a time.
- Focused validation has passed before any expansion node.
- Node-to-test or node-to-observation gaps are accepted explicitly or closed.
- Required node scorecards have verdicts. Any required `blocked-by-observability-gap` blocks the run-level optimization verdict until the missing node-to-artifact, trace, metric, or source-ref link is repaired.

## Run Metrics Summary

Fill this section when baseline, scorecard, comparison, optimization, or quality measurement is in scope.

| Node | Useful Unit | Quality Gate | Stage Loss Summary | Verdict |
|------|-------------|--------------|--------------------|---------|
| `<node-id>` | `<unit>` | `<pass|fail|blocked|n/a>` | `<loss-or-delta>` | `<pass|regression|improved|neutral|blocked|blocked-by-observability-gap>` |

Run-level metrics verdict:
- Selected variant:
- Required node verdicts:
- Blocking observability gaps:
- Baseline fixture identity:
- Candidate fixture identity:
- Quality gate rule: improvement counts only after the quality gate passes.

## Expansion Strategy

Define expansion nodes after the focused chain passes.

| Expansion Node | Variable Changed | Starting Scope | Target Scope | Pass Criteria |
|----------------|------------------|----------------|--------------|---------------|
| `<EXP-node>` | `<dimensions|maxFiles|toolset|provider|wait-mode>` | `<focused-scope>` | `<expanded-scope>` | `<invariant>` |

## Final Outcome

- Overall status:
- Nodes passed:
- Nodes failed or blocked:
- Repairs made:
- Verification:
- Attachments used:
- Residual risk:
- Next recommended node/action:

## Execution Handoff

- Next node to execute:
- Commands or actions allowed:
- Plan sections to update:
- Attachments allowed only if too large for inline summary:
- Stop condition for the next executor:
- Facts the executor must not assume:

## Open Questions

- `<question>`
