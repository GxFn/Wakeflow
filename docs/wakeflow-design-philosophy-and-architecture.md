# Wakeflow design philosophy, best practices, and architecture optimization

Date: 2026-06-10

This document is a synthesis note for Wakeflow after the current implementation has become usable in real controller/target work. It does not propose a rebuild. It maps Wakeflow's existing code and operating model to durable workflow, reconciliation, human-task, and observability practices, then identifies the architecture refinements that would make the system more robust while preserving Wakeflow's own philosophy.

## Executive Summary

Wakeflow should stay a local-first control plane for multi-window Codex work. Its core strength is not "run more scripts" or "fully automate every decision". Its core strength is that it makes agent work explicit:

- a demand has one state root;
- the controller owns judgment and acceptance;
- target windows receive bounded task packages;
- side effects are recorded as envelopes, run records, result envelopes, and review artifacts;
- documents are projections, not state authority;
- automation stops at clear boundaries instead of silently polling or inventing next work.

The best architecture direction is therefore not to turn Wakeflow into a monolithic workflow engine. It should become a sharper local control plane with four stable planes:

1. Control plane: demand state, controller decisions, task-package lifecycle, and MCP tool contracts.
2. Execution plane: target-window dispatch, host-thread send/readback, and target result recording.
3. Evidence plane: result envelopes, review packs, verification outputs, controller events, and ledgers.
4. Projection plane: progress Markdown, TODO boards, handoff boards, README/status summaries, and human-readable traces.

The next robustness work should concentrate on state-machine hardening, idempotent side effects, clearer retry/error taxonomy, replayable evidence, transport adapters, and operational observability. These are incremental changes that fit the current design.

## Current Implementation Reality

This review is grounded in the current Wakeflow repository, especially:

- `.codex-plugin/plugin.json`
- `AGENTS.md`
- `README.md`
- `README.zh-CN.md`
- `scripts/README.md`
- `lib/wakeflow-runtime.mjs`
- `lib/wakeflow-mcp-tools.mjs`
- `mcp/server.cjs`
- `scripts/wakeflow-state.mjs`
- `scripts/wakeflow-delivery.mjs`
- `scripts/wakeflow-intake.mjs`
- `scripts/wakeflow-next-work.mjs`
- `scripts/wakeflow-verify.mjs`
- `schemas/wakeflow-state-machine/*.schema.json`
- `skills/wakeflow-governance/references/*.md`

The implementation already has a coherent shape.

### Stable Public Surface

Wakeflow exposes MCP tools as its stable workflow contract. `mcp/server.cjs` implements a small JSON-RPC server and delegates tool calls through `lib/wakeflow-mcp-tools.mjs`. `lib/wakeflow-runtime.mjs` whitelists allowed backend scripts and runs only those named script entrypoints with a controlled environment.

This is a good boundary: MCP tools are the public operating surface; scripts are implementation machinery.

### State Root as Authority

`scripts/wakeflow-state.mjs` owns state-root creation and revisioned state updates. The state-root bundle includes machine-owned files such as:

- `demand.json`
- `wakeflow-state.json`
- `controller-events.jsonl`
- `projection.json`
- `developer-progress.md`

The code and docs consistently treat `developer-progress.md` as a projection rather than authority. That distinction is central to Wakeflow's reliability.

### Dispatch and Return Boundaries

`scripts/wakeflow-delivery.mjs` owns the most important side-effect path:

- prepare dispatch from state;
- build task packages and delivery envelopes;
- record delivery runs;
- record target results;
- review pack readiness;
- build controller-return envelopes.

The existing behavior intentionally stops after host send/readback and avoids polling or sleeping. That is correct. The host send/readback is a transport side effect, not acceptance.

Wakeflow supports two controller-return policies for multi-window waves. The controller chooses the policy before dispatch and the dispatch group keeps that policy stable.

- `group-ready`: the controller dispatches multiple target windows, individual target completion does not return immediately, and the first eligible controller-return represents the sent targets that are ready or blocked. The controller-return prompt may say `Continue controller review: PluginWindow, RuntimeWindow, CoreWindow backfill.` when the ready or blocked set covers those windows. Targets that are known but not yet sent stay visible as `pendingDispatchTargets` and are not silently treated as completed.
- `per-target`: the controller dispatches multiple target windows, each target result can create its own controller-return, and the controller receives those returns independently. The controller still owns ordering and acceptance, and it must process or explicitly account for every returned target before closing the demand.

### Target Windows Are Bounded Workers

The target-window skill and delivery prompts tell target windows to execute only their assigned dispatch packet and return a `TargetResultEnvelope`. They must not claim follow-up work, mutate the controller state machine, or treat local completion as controller acceptance.

This is one of Wakeflow's strongest design decisions. It keeps multi-window work from turning into distributed improvisation.

### Design and Test Are Intake/Evidence Roles

`scripts/wakeflow-intake.mjs` bridges Design/Test handoff material into the state root, but does not dispatch or accept work. The Design/Test skills are meant to help decide, clarify, compare, validate, and provide evidence. They should be recommended when useful, but should not become automatic paperwork generators.

This matches the user's observed operating model: Design/Test should be more actively recommended when real demand or testing work benefits from them, while still requiring judgment before invoking a skill.

### Verification Is Boundary-Oriented

`scripts/wakeflow-verify.mjs` checks repository residue, workspace docs, script layout, and other boundary conditions. It is a governance tool. It should remain strict about local state and cautious about converting transport success into semantic completion.

## Wakeflow Design Philosophy

The following principles should be treated as Wakeflow's design philosophy.

### 1. Wakeflow Is a Control Plane, Not a Worker Pool

Wakeflow coordinates agent work. It should not hide judgment inside scripts, nor should it turn every tool result into a new autonomous branch of work.

The controller makes decisions. Target windows produce evidence. Scripts enforce boundaries and prepare artifacts.

### 2. State Roots Are the Truth, Documents Are Projections

State-root JSON and event records are the durable machine truth. Markdown progress files, TODO boards, handoff boards, and README content are useful human projections.

The design should keep this distinction visible:

- JSON/event files answer "what is the current machine state?"
- Markdown answers "how should a human understand what happened?"
- Git ledger/archive files answer "what should remain historically traceable?"

### 3. Side Effects Must Be Explicit and Recorded

Every meaningful side effect should have a durable record:

- dispatch prepared;
- host send attempted;
- host send readback succeeded or failed;
- target result imported;
- review pack generated;
- controller-return envelope generated;
- controller-return sent;
- demand accepted, reworked, blocked, or completed.

Wakeflow should never rely on "the assistant said it probably happened" when a side-effect record can exist.

### 4. The Controller Does Not Poll

The current implementation's "stop after send/readback" rule is philosophically correct. It prevents runaway loops, keeps user-visible control, and avoids accidental acceptance after a transport event.

Automation should resume through explicit controller turns, target returns, or host-dispatched continuation, not hidden sleep loops.

### 5. Fail Closed on Identity, Scope, and Evidence

Wakeflow should fail closed when it cannot prove:

- the current window role;
- the active demand;
- the state root;
- the task package;
- the target thread id;
- the delivery envelope;
- the target result;
- the review readiness condition.

Failing closed is not friction; it is the safety mechanism that keeps unattended work trustworthy.

### 6. Recommendation Is Not Invocation

Design/Test skills should be recommended more proactively when a developer is doing demand design or test validation. But recommendation must be preceded by a small judgment step:

- Does this task actually need the skill?
- Would the skill improve clarification, option comparison, evidence quality, or validation?
- Would using it add paperwork without improving the outcome?

If the answer is "not useful", the agent should continue without the skill. If the answer is "useful or likely useful", the agent should propose or use the skill according to the current role and permissions.

### 7. Transport Evidence Is Not Product Acceptance

A sent delivery, readback OK, imported result, or controller-return envelope is transport evidence. It is not product acceptance. Acceptance requires controller judgment based on raw evidence, tests, diffs, and scope.

This distinction should stay explicit in every tool response and status projection.

## External Best Practices and Wakeflow Mapping

### Reconciliation Controllers

Kubernetes describes controllers as control loops that watch current state and move it toward desired state. It also recommends simpler controllers rather than a monolithic set of interlinked loops. Source: [Kubernetes controller pattern](https://kubernetes.io/docs/concepts/architecture/controller/).

Wakeflow already behaves like a local reconciliation controller:

- desired/current state lives in the state root;
- `wakeflow_status` and `wakeflow_next_work` inspect state;
- `wakeflow_review_pack` evaluates whether results are ready;
- reducer/review tools decide the next state transition.

Optimization implication:

- Keep Wakeflow tools small and composable.
- Add more explicit reconciliation decision records instead of embedding decisions in prose.
- Avoid a single all-powerful "advance everything" tool that hides which precondition passed.

### GitOps Desired State

OpenGitOps emphasizes declarative desired state, versioned and immutable state, automatic pull, and continuous reconciliation. Source: [OpenGitOps principles](https://opengitops.dev/).

Wakeflow is not pure GitOps because its active runtime lives partly under local untracked state. That is appropriate because real thread ids and local delivery runs should not be committed. But Wakeflow can still borrow the pattern:

- tracked ledgers and archives preserve durable history;
- `.workspace-active` contains active machine state;
- `.workspace-local` contains local transport/runtime information.

Optimization implication:

- Keep sensitive local transport data out of tracked files.
- Make state-root archive/ledger snapshots explicit enough to reconstruct why a decision was made.
- Treat tracked archives as immutable history once committed.

### Durable Execution and Determinism

Durable Task and Durable Functions use event sourcing, replay, and deterministic orchestrator constraints. Orchestrators must avoid nondeterministic work and external side effects directly inside replayed logic. Source: [Durable Task orchestrator code constraints](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-code-constraints).

Temporal similarly records nondeterministic side effects in workflow history so they are not re-executed on replay. Source: [Temporal side effects](https://docs.temporal.io/develop/go/workflows/side-effects).

Wakeflow's closest equivalent is:

- state transition events in `controller-events.jsonl`;
- delivery-run records;
- target-result envelopes;
- review packs;
- controller-return envelopes.

Optimization implication:

- Treat every host send and target result import as an idempotent side effect with a stable key.
- Add replay tests that rebuild projection state from event/artifact history.
- Keep side-effect execution separate from state reduction.

### Error Handling and Retry Policy

AWS Step Functions models explicit errors, retry policies, catch paths, backoff, max attempts, max delay, and jitter. Source: [AWS Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html).

Wakeflow should not retry product implementation automatically. But it can safely retry transport or local adapter operations when idempotency is guaranteed.

Optimization implication:

- Define typed error classes for Wakeflow runtime failures.
- Support bounded retry only for safe transport operations, such as host-send attempts with the same envelope id.
- Keep target implementation failures as evidence for controller review, not as hidden retries.

### Trace Context and Correlation

OpenTelemetry context propagation lets traces, metrics, and logs be correlated across service boundaries. Source: [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/).

Wakeflow already carries many correlation fields:

- `demandKey`
- `stateRoot`
- `stateRevision`
- `taskPackageId`
- `targetTaskId`
- `deliveryEnvelopeId`
- `deliveryRunId`
- `targetResultId`

Optimization implication:

- Normalize these into a `wakeflowTrace` object carried by every envelope, event, result, review pack, and projection.
- Emit the trace context in tool output, not just files.
- Make it easy to answer: "which demand, package, target, delivery, and result does this line belong to?"

### SRE Monitoring

Google SRE distinguishes symptoms from causes and uses the four golden signals: latency, traffic, errors, and saturation. Source: [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/).

Wakeflow's current health view is mostly state and boundary correctness. It can evolve into operational health without becoming noisy.

Optimization implication:

- Latency: time in each demand/task/result state.
- Traffic: active demands, delivery attempts, target results, controller returns.
- Errors: failed sends, schema failures, blocked target results, invalid state transitions.
- Saturation: pending dispatch count, missing result count, active window count, queue depth.

### Human Task Orchestration

Camunda models human tasks as work performed by users while a workflow engine coordinates the process and consumes user decisions. Source: [Camunda human task orchestration](https://docs.camunda.io/docs/guides/orchestrate-human-tasks/).

Wakeflow's controller and target windows are agent/human hybrid tasks. The architecture should make human or controller decisions explicit rather than burying them in generated paragraphs.

Optimization implication:

- Add explicit decision records for user/controller acceptance, rework, block, pause, and scope change.
- Keep Design/Test recommendations visible but optional unless the active workflow requires them.
- Distinguish "needs user confirmation" from "needs target result" and "needs controller judgment".

## Proposed Architecture Frame: Four Planes and One Spine

The architecture can be described as four planes connected by an evidence spine.

### Control Plane

Responsibilities:

- demand lifecycle;
- state machine transitions;
- task-package creation;
- controller decisions;
- MCP public contracts;
- governance rules and skills.

Primary files and modules:

- `schemas/wakeflow-state-machine/*.schema.json`
- `scripts/wakeflow-state.mjs`
- `lib/wakeflow-mcp-tools.mjs`
- `lib/wakeflow-runtime.mjs`
- `skills/wakeflow-governance/*`

Optimization focus:

- stronger transition preconditions;
- typed decision objects;
- explicit conflict handling by `stateRevision`;
- fewer implicit prose-only conclusions.

### Execution Plane

Responsibilities:

- delivery envelope creation;
- host-thread send and readback;
- target-window task execution;
- target result import;
- controller-return send.

Primary files and modules:

- `scripts/wakeflow-delivery.mjs`
- `.workspace-local/wakeflow-delivery/thread-registry`
- `.workspace-local/wakeflow-delivery/delivery-runs`
- `.workspace-local/wakeflow-delivery/delivery-envelopes`

Optimization focus:

- host-send adapter interface;
- idempotent send attempts;
- resend policy for stale or interrupted sends;
- explicit readback status and target thread identity validation.

### Evidence Plane

Responsibilities:

- raw evidence references;
- target result envelopes;
- review packs;
- verification outputs;
- state transition events;
- archive/ledger summaries.

Primary files and modules:

- `controller-events.jsonl`
- `target-results/*.json`
- `transition-candidates/*.json`
- `scripts/wakeflow-verify.mjs`
- archive/ledger files generated by scripts.

Optimization focus:

- provenance and trace context on every evidence record;
- replayable reducer fixtures;
- typed evidence sufficiency checks;
- clearer difference between transport proof and acceptance proof.

### Projection Plane

Responsibilities:

- user-facing progress;
- status summaries;
- TODO/archive boards;
- README and skill guidance;
- controller-ready prompts.

Primary files and modules:

- `developer-progress.md`
- `global-todo-board.md`
- `workspace-record-map.md`
- README and skill documents.

Optimization focus:

- never treat projections as authority;
- make stale projections detectable;
- render final state from machine state rather than hand-editing status;
- show which skills were used or recommended and why.

### Evidence Spine

The evidence spine is the chain:

`Demand -> State Root -> Task Package -> Delivery Envelope -> Delivery Run -> Target Result -> Review Pack -> Controller Decision -> Archive/Ledger`

Every major tool should either read from this spine, append to it, or produce a projection from it. If a tool cannot say where it sits on the spine, its boundary is probably unclear.

## Architecture Optimization Themes

### 1. Normalize a `wakeflowTrace` Object

Introduce a shared trace object in artifacts:

```json
{
  "demandKey": "...",
  "stateRoot": "...",
  "stateRevision": 3,
  "taskPackageId": "...",
  "targetTaskId": "...",
  "targetWindow": "ProductWindow",
  "deliveryEnvelopeId": "...",
  "deliveryRunId": "...",
  "targetResultId": "...",
  "controllerEventId": "..."
}
```

This is not only observability. It prevents many boundary mistakes because every artifact carries its place in the chain.

### 2. Add a Typed Error Taxonomy

Recommended first-pass error codes:

- `state-root-missing`
- `state-revision-conflict`
- `window-role-mismatch`
- `thread-registry-missing`
- `thread-id-unverified`
- `delivery-envelope-missing`
- `delivery-already-sent`
- `host-send-failed`
- `host-readback-unconfirmed`
- `target-result-missing`
- `target-result-schema-invalid`
- `evidence-insufficient`
- `group-not-ready`
- `controller-decision-required`
- `unsafe-retry`
- `scope-boundary-violation`

Tool output should include both a human message and a machine error code. This makes controller behavior more reliable and makes future UI/status surfaces easier to build.

### 3. Separate Reducer Logic from Side Effects

Current scripts are already cautious, but `scripts/wakeflow-delivery.mjs` contains many responsibilities. The CLI surface can remain stable while the internals split into modules:

- `delivery/state-ref.mjs`
- `delivery/thread-registry.mjs`
- `delivery/envelope-builder.mjs`
- `delivery/host-send-adapter.mjs`
- `delivery/result-store.mjs`
- `delivery/review-pack.mjs`
- `delivery/controller-return.mjs`
- `delivery/idempotency.mjs`

This would reduce future regression risk without changing the MCP contract.

### 4. Make Idempotency First-Class

Each command with side effects should document:

- idempotency key;
- duplicate behavior;
- safe retry conditions;
- unsafe retry conditions;
- artifact written;
- event appended;
- projection updated.

Example:

| Command | Idempotency key | Duplicate behavior |
| --- | --- | --- |
| `prepare-dispatch-from-state` | state root + package id + target id + state revision | return existing prepared envelope or fail if state changed |
| `record-delivery-run` | delivery envelope id + host thread id + send attempt id | append attempt, do not overwrite prior attempts |
| `record-target-result` | target result id or target id + package id + attempt | reject duplicate unless explicitly superseded |
| `build-controller-return` with `group-ready` | dispatch group + group readiness revision | allow one controller-return for the group wave; fail if sent targets are still missing results or a group return is already pending/sent |
| `build-controller-return` with `per-target` | dispatch group + trigger target + trigger task id | allow one controller-return per target/task; fail only for a duplicate pending/sent return for the same target/task |

### 5. Add Replay and Fixture Tests

Wakeflow should have tests that prove:

- a state root can be rebuilt from event history and artifacts;
- old fixture states still reduce to the same projection;
- duplicate host-send records do not create duplicate acceptance;
- `group-ready` does not return to the controller while any sent target in the group is missing a result, and it preserves unsent targets as pending dispatch instead of pretending the whole group is complete;
- `per-target` sends only the intended target return, permits later independent target returns in the same group, and blocks duplicates for the same target/task;
- stale state revisions fail closed.

This borrows durable workflow replay discipline without requiring a full workflow engine.

### 6. Strengthen Schema Boundaries Carefully

Some schemas should remain extensible, but extension points should be named rather than allowing broad `additionalProperties: true` everywhere.

Recommended pattern:

- strict top-level fields for state-machine objects;
- `diagnostics` for runtime/tool diagnostic data;
- `extensions` for forward-compatible optional metadata;
- `legacyCompatibility` only when deliberately preserving older contracts.

This matches the existing direction in recent Plugin MCP contract work and helps avoid accidental global bags of fields.

### 7. Make Skill Recommendation a First-Class Decision

Design/Test skill selection can become a lightweight controller-side or agent-side step:

```json
{
  "skillRecommendation": {
    "skill": "design:requirement-clarification",
    "decision": "recommend",
    "reason": "requirements contain multiple unresolved implementation options",
    "notUsedBecause": null
  }
}
```

This prevents two failure modes:

- skills are invisible when they would help;
- skills are invoked as documentation rituals when they add no value.

### 8. Add Operational Health to `wakeflow_status`

`wakeflow_status` can stay concise while exposing a health summary:

- active demand count;
- current state and time in state;
- pending dispatch count;
- missing target result count;
- pending host sends;
- blocked target results;
- stale projections;
- dirty tracked ledger/archive files;
- last controller event id;
- last verification status.

The status should separate:

- "healthy and idle";
- "healthy and waiting for target";
- "blocked by missing local state";
- "blocked by evidence insufficiency";
- "blocked by dirty repo/governance residue";
- "needs controller judgment".

### 9. Preserve Manual Control Over Acceptance

Even with better reducers, acceptance should remain explicit:

- target result import is not acceptance;
- group-ready is not acceptance;
- controller-return send is not acceptance;
- verification pass is not acceptance;
- `complete-demand` is the semantic boundary.

This protects Wakeflow's trust model.

## Suggested Roadmap

### P0: Documentation and Contract Clarification

- Add this design philosophy document.
- Add a small architecture map to README or `skills/wakeflow-governance/references/wakeflow-architecture.md`.
- Document each MCP tool by plane, side effects, idempotency key, and stop condition.
- Keep current behavior unchanged.

### P1: Trace and Error Taxonomy

- Add `wakeflowTrace` to new artifacts.
- Add typed error codes to MCP tool responses.
- Add a `diagnostics` object for non-authoritative runtime detail.
- Update tests for representative error cases.

### P2: Delivery Module Split

- Keep CLI and MCP tool names stable.
- Split `scripts/wakeflow-delivery.mjs` internals into focused modules.
- Add unit tests around host-send adapter, thread registry, review pack, and controller-return builder.

### P3: Replay and Idempotency

- Add replay fixture tests for state roots and delivery artifacts.
- Add duplicate-side-effect tests.
- Add explicit supersede/retry behavior for delivery runs.
- Add state-revision conflict tests.

### P4: Operational Observability

- Add `wakeflow_status --health` or include compact health fields in existing status.
- Add optional local metrics/projection file.
- Add stale projection detection.
- Add trace lookup command: "show me the spine for this target result".

### P5: Optional Adapter Layer

- Define a host-send adapter boundary for Codex app thread dispatch.
- Keep real host credentials/thread ids local.
- Support future adapters without changing the state-machine contract.

## Non-Goals

Wakeflow should not:

- become a cloud workflow engine;
- store real thread ids in tracked workspace documents;
- auto-accept product work based only on transport success;
- let target windows create follow-up work unless explicitly dispatched;
- make Design/Test skills mandatory paperwork;
- hide controller decisions inside direct script invocations;
- collapse all MCP tools into one opaque "advance workflow" command.

## Immediate Practical Recommendations

1. Keep the current MCP tool split. It is clearer than a merged all-in-one tool because it exposes boundaries.
2. Improve tool output language so every result says whether it is state, transport, evidence, projection, or acceptance.
3. Introduce a shared trace context before adding more automation.
4. Add typed error codes before adding retry behavior.
5. Split `wakeflow-delivery.mjs` only after P1 tests protect current semantics.
6. Make Design/Test recommendation logic more explicit in skills and docs, but keep invocation conditional on real usefulness.
7. Treat replay fixtures as the key safety net for future architecture changes.

## Best-Practice Sources

- [Kubernetes Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - reconciliation loops, desired/current state, and simpler controller design.
- [OpenGitOps Principles](https://opengitops.dev/) - declarative desired state, versioned/immutable state, and reconciliation.
- [Durable Task orchestrator code constraints](https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-code-constraints) - event sourcing, replay, and deterministic orchestration.
- [Temporal Workflow side effects](https://docs.temporal.io/develop/go/workflows/side-effects) - recording nondeterministic side effects in workflow history.
- [AWS Step Functions error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) - typed errors, retry, catch, backoff, and jitter.
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/) - trace and context correlation across boundaries.
- [Google SRE: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) - symptoms, causes, and the four golden signals.
- [Camunda: Orchestrate Human Tasks](https://docs.camunda.io/docs/guides/orchestrate-human-tasks/) - human decision tasks coordinated by workflow state.
