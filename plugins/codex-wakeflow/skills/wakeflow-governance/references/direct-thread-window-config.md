# Window Identity And Direct-Thread Reference

## Purpose

Direct-thread delivery needs one host-local mapping from a stable typed
`windowId` to the real Codex thread handle. The mapping is runtime identity,
not tracked project documentation and not part of the transport packet.

## Identity Authority

`wakeflow_register_window` with `operation: "register"` is the only normal
writer for a newly created Codex thread. It records the raw handle only in the
typed binding under
`.wakeflow-local/runtime/hosts/codex/identity/window-bindings/<windowId>.json`
and returns a redacted result. Agents never hand-write that file.

`wakeflow_replace_windows` owns inspection, replacement intent, and exact
decommission through its `inspect`, `replace`, and `decommission` operations.
Replacement does not mutate unrelated bindings. Codex decommission evidence
always remains `manual-host-gate`: an archived task is not machine-verifiable
proof that the Agent cannot run again or that its worktree/branch is gone.

Never write a real thread handle to tracked Markdown, prompts, GitHub, target
result text, archive records, examples, or fixtures. Never register a
placeholder such as `current-thread`, `unknown`, or `<thread-id>`.

## Runtime Projection

`.wakeflow-local/runtime/hosts/codex/projections/window-runtime/<windowId>.json`
is a redacted, regenerable projection of strict config plus the current typed
binding. It may describe role, repository responsibility, delivery eligibility,
and binding status. It never contains the raw thread handle and never becomes a
second identity or config authority.

## Coordination And Transport

Target effects are serialized by the exact typed lease at
`.wakeflow-local/runtime/shared/coordination/window-leases/<windowId>.json`.
The lease is bound to the current binding, demand, task, and delivery tuple.
Older deliveries and historical results cannot release a successor lease.
Controller-return delivery takes no target work lease.

Current transport records live only under
`.wakeflow-local/runtime/shared/transport/demands/<demandId>/`:
`groups/`, `packets/`, `envelopes/`, and `runs/`. TargetResult authority remains
in the active demand state, not in another local result store. Selection follows
the exact current state/binding/envelope lineage; never choose by mtime or a
semantic window name.

## Send Policy

Target delivery is a closed sequence:

1. `wakeflow_prepare_delivery operation=target-preview` performs a zero-write
   plan.
2. `operation=target-apply` freezes the exact group, packet, and envelope.
3. `operation=target-claim` acquires the exact current lease immediately before
   the host effect.
4. The Codex host tool sends under its operation fence and performs at most one
   bounded readback.
5. `wakeflow_record_delivery operation=target-outcome` records the observed
   outcome; it is not the host-effect fence.

Accepted or ambiguous sends and accepted sends with pending/unavailable
readback are never resent automatically. Rejected-before-send needs explicit
`operation=target-rearm`; no hidden schedule, heartbeat, or fallback route may
invent another attempt.

## Pod Identity

Pod first materialization uses
`wakeflow_pod_open operation=launch-preview/launch-apply` and records launch
facts with `wakeflow_pod_record operation=record-materialization`. Register
only the final real `threadId`; a temporary `clientThreadId` is digest-only
recovery evidence and can never become a binding. Finish with
`wakeflow_pod_bind operation=creation-receipt` using the exact cwd/Git receipt.

Existing Pod materialization is inspected with
`wakeflow_pod_open operation=inspect-materialization`. It never discovers or
creates a replacement and never falls back to mainline. Pod Test additionally
requires the exact validated `test-access-receipt` covering every active
product binding.

## Controller Return

Controller return uses the dispatch group's stamped `controllerWindowId` and
current typed binding. Plan/apply/pre-send are the
`controller-preview/controller-apply/controller-pre-send` operations; the
host effect remains separate and its fact is recorded with
`wakeflow_record_delivery operation=controller-outcome`. An accepted,
ambiguous, or sent-unconfirmed current result set is deduplicated and must not
be sent again.

Legacy `.wakeflow-local/wakeflow-delivery/**` registry, window-config, lock,
and result files are explicit-migration input only. Normal v3 agents neither
read them as authority nor write them.
