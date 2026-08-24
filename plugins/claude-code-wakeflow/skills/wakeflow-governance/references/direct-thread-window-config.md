# Window Identity And Direct-Session Reference

## Purpose

Claude transport needs one host-local mapping from a stable typed `windowId`
to the real Claude Code session handle and its verified host locator. The
mapping is runtime identity, not tracked project documentation and not part of
the transport packet.

## Identity Authority

`wakeflow_register_window` with `operation: "register"` is the only normal
writer after a v3 Claude host owner has created a session. It records the raw
handle only in the typed binding under
`.wakeflow-local/runtime/hosts/claude-code/identity/window-bindings/<windowId>.json`
and returns a redacted result. Agents and legacy helpers never hand-write that
file.

`wakeflow_replace_windows` owns inspection, replacement intent, and exact
decommission through its `inspect`, `replace`, and `decommission` operations.
Replacement does not mutate unrelated bindings. Claude closure becomes
machine-verifiable only after the exact close operation and an absence probe
both succeed; unknown evidence stays blocked.

Never write a real session handle or locator to tracked Markdown, prompts,
target result text, archive records, examples, or fixtures. Never register a
placeholder such as `current-session`, `unknown`, or `<session-id>`.

## Runtime Projection And Locator

`.wakeflow-local/runtime/hosts/claude-code/projections/window-runtime/<windowId>.json`
is a redacted, regenerable projection of strict config plus the current typed
binding. It may describe role, repository responsibility, delivery eligibility,
and binding status. It never contains the raw session handle and never becomes
a second identity or config authority.

Live tmux/session facts belong to the Claude host locator/operation owner under
`.wakeflow-local/runtime/hosts/claude-code/operations/`. A locator is evidence
for a host effect, not an alternative binding. Route launch through the current
v3 host facade's exact `launch-window` command. If the host effect or receipt
cannot be established, report the host-neutral intent and stop; never write a
retired `window-host` record to simulate activation.

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
4. The v3 Claude transport adapter holds its stable-window operation mutex
   across preflight, physical paste, and bounded readback.
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
only the final real session handle, then finish with
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

Legacy `.wakeflow-local/wakeflow-delivery/**` thread-registry, window-config,
window-host, lock, and result files are explicit-migration input only. Normal
v3 agents and the v3 host adapter neither read them as authority nor write
them.
