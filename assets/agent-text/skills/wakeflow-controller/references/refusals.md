# Refusals by code and reason

<!-- Generated from the source by `npm run refusals:build`. Do not edit: change the code or the generator's notes, then rebuild. -->

A refusal is the tool telling you why it did nothing. Act on its `code` first; the
`reason` narrows it and `path` names the field or the state concerned. `invalid-request`
is not listed: its `path` and `details.schema` already name the field to fix. `io-failure`
and `unexpected` are failures, not refusals - the skill's rule for them applies. Preview
`blockerCodes` are explained where their tool is (`workspace-and-windows.md`,
`delivery-and-review.md`). A reason written `<like-this>` carries a value in that place.

## `concurrency-conflict` - something changed between your read and this call

A revision, a claim, a binding or a lock is no longer what the request assumed. Do not resend the same call. Read again - `wakeflow_status` (with the Demand id), or the tool's own inspect or preview - take the new revision, digest or generation from that result, and decide whether the call is still wanted. `retryable: true` marks the transient ones (a writer or a lock was busy): after reading status once, the same call may be repeated.

- **delivery**: `stream-revision`
- **demand**: `archive-raced`, `payload-changed`, `publication-<reason>`, `stream-advanced`, `stream-revision`
- **endpoint**: `binding-changed`, `binding-lock`, `claim-changed`
- **evidence**: `demand-root-read-source-changed`
- **kernel**: `claim-state-changed`, `claim-state-exists`, `claim-state-lock-<reason>`, `operation-scope-<reason>`, `pod-lock-<reason>`
- **pod**: `config-<reason>`
- **requirement**: `claim-state-drift`, `ledger-lock`
- **result-review**: `stream-revision`
- **tasking**: `stream-revision`
- **workspace**: `maintenance-gate`

## `idempotency-mismatch` - this idempotency key already belongs to a different request

If you are retrying a call whose response was lost, resend the original request unchanged with the same key - it replays the stored outcome and writes nothing. If you rebuilt the request from memory and a field differs, do not repair it with a new key: a new key is a second write. Read the stored outcome first (status, or the tool's inspect) and use a new key only for an operation that is new.

- **delivery**: `request-digest`
- **result-review**: `request-digest`
- **tasking**: `request-digest`

## `precondition-failed` - the workspace state does not allow this now

The reason names the condition; `path` names the request field or the state it concerns, and `details.blocker`, `details.blocker2`... carry every blocker of a refused preview. Resolve the condition with the tool that owns it, then preview or call again. A stale digest or snapshot means read again, not retry; a refusal about a claim or a window in use means wait or read status - never release a live claim and never edit state by hand to make a refusal pass.

- **configuration**: `config-authority`, `config-version-unsupported`
- **delivery**: `authority-<reason>`, `binding-changed`, `binding-host`, `binding-missing`, `binding-store`, `callback-phase`, `commit-empty`, `commit-kind`, `decision-rejected`, `fence-mismatch`, `outcome-missing`, `record-<reason>`, `remediation-history`, `remediation-phase`, `rerun-decision`, `rerun-history`, `rerun-phase`, `result-missing`, `rework-decision`, `rework-history`, `rework-phase`, `target-work-type`, `task-package-missing`, `window-unknown`, `worktree-receipt-missing`, `worktree-receipt-stale`
- **demand**: `archive-conflict`, `archive-manifest-digest`, `archive-manifest-missing`, `archive-manifest-schema`, `archive-outcome:<outcome>`, `archive-payload-drift`, `authority-<reason>`, `command-<reason>`, `completion-<reason>`, `completion-route`, `demand-authority-<reason>`, `demand-root-<reason>`, `demand-root-absent`, `demand-root-drift`, `demand-root-not-directory`, `demand-root-special-node`, `journal-action:<action>`, `ledger-root`, `ledger-root-alias`, `ledger-root-missing`, `package-claim:<status>`, `package-record-absent`, `pod-unknown`, `publication-<reason>`, `terminal-commit-mismatch`, `transaction-<reason>`
- **endpoint**: `binding-drift`, `claim-active`, `claim-drift`, `claim-held`, `closure-blocked`, `handle-changed`, `handle-conflict`, `handle-unchanged`, `hook-evidence-missing`, `launch-intent-drift`, `locator-provider`, `observation-file-<reason>`, `observation-file-content`, `observation-file-digest`, `registered-at-not-monotonic`, `relocate-not-applicable`, `worktree-occupied`, `worktree-outside-workspace`, `worktree-repository-unavailable`
- **entrypoints**: `runtime-artifact-outdated`, `runtime-artifact-unavailable`, `tool-not-for-role`
- **evidence**: `capacity`, `config-authority`, `demand-authority`, `demand-root-<reason>`, `evidence-commit-missing`, `source-changed`, `source-missing`, `source-root`, `source-type`
- **governance**: `archive-manifest`, `board-unavailable`, `claim-demand-id`, `coverage-reference-drift`, `coverage-task-package-missing`, `ledger-root-missing`, `pod-busy`, `pod-lifecycle-residue`, `pod-publication-residue`, `recovery-demand-identity`, `recovery-plan-drift`, `requirement-member-drift`, `requirement-member-missing`, `requirement-record-drift`
- **kernel**: `active-layout-exists`, `active-layout-node-policy`, `active-layout-not-current`, `claim-<transition>-from-<status>`, `claim-archive-without-claim`, `claim-drift`, `claim-reclaim-other-demand`, `claim-state-chain`, `commit-id-conflict`, `config-authority`, `event-id-conflict`, `idempotency-key-conflict`, `index-anchor`, `maintenance-recovery-required`, `observation-conflict`, `operation-scope-expired`, `operation-scope-missing`, `operation-scope-promotion`, `operation-scope-root-mismatch`, `plan-blocked`, `plan-drift`, `window-claimed`, `worktree-receipt`, `writer-protocol-unsupported`
- **observation**: `demand-<issue>`, `demands-unavailable`, `ledger-root`, `ledger-root-missing`
- **pod**: `binding-store`, `config-<reason>`, `plan-drift`
- **requirement**: `design-surface-alias`, `design-surface-root`, `ledger-root`, `ledger-root-alias`, `ledger-root-missing`, `plan-drift`, `record-conflict`
- **result-review**: `authority-<reason>`, `binding-changed`, `binding-host`, `binding-missing`, `binding-store`, `commit-empty`, `commit-kind`, `controller-authority`, `decision-rejected`, `delivery-host`, `fence-mismatch`, `lifecycle-<lifecycle>`, `outcome-missing`, `outcome-rejected`, `pod-unknown`, `record-<reason>`, `review-unit-stale`, `snapshot-stale`, `task-package-missing`, `window-unknown`, `work-type`, `worktree-branch-required`
- **tasking**: `authority-<reason>`, `authority-reference-unknown`, `commit-not-planning`, `decision-rejected`, `requirement-member-drift`, `requirement-member-missing`, `requirement-record-<reason>`, `requirement-record-drift`, `research-demand-has-no-implementation`
- **workspace**: `config`, `launch-intent`, `plan-stale`

## `not-found` - the identifier names nothing here

Take identifiers only from a previous result. Read `wakeflow_status` or the board again; an archived Demand is addressed through its archive receipt.

- **delivery**: `delivery-unknown`, `envelope-unknown`, `target-unknown`
- **demand**: `demand-unknown`, `journal-absent`, `publication-absent`
- **endpoint**: `binding-absent`, `claim-absent`, `window-unknown`
- **kernel**: `claim-absent`
- **observation**: `demand-unknown`
- **requirement**: `design-surface`, `origin-window`, `package-document`, `package-unknown`, `record-absent`
- **result-review**: `delivery-unknown`, `envelope-unknown`, `result-unknown`, `target-unknown`

## `capacity-exceeded` - a bounded size or count is full

Reduce what the request carries, or tell the user which bound was reached; do not split one record into several to get around it.

- **delivery**: `prompt-capacity`
- **kernel**: `index-bytes`, `list-page-items`, `projection-bytes`, `prompt-characters`
- **result-review**: `prompt-capacity`

## `recovery-required` - an earlier write was interrupted

Finish that operation's recovery before anything else. For maintenance, `details.operationId` goes to maintenance recover and, without one, preview reconcile; the Demand, requirement, evidence and pod tools take `mode: recover` themselves, with the operation the refusal names. See "Interrupted writes and cancellation" in `workspace-and-windows.md`.

- **demand**: `claim-state-vanished`, `demand-publication`, `demand-root-and-archive-absent`, `demand-root-restore`, `demand-root-vanished`, `journal-invalid`, `journal-verify-missing`
- **endpoint**: `binding-store`
- **kernel**: `operation-scope-release-failure`
- **pod**: `config-<reason>`
- **requirement**: `claim-state-vanished`, `ledger-publication`, `record-vanished`
- **workspace**: `maintenance-gate-residue`, `maintenance-recovery-artifact-mismatch`

## Reasons where the first instinct is wrong

- `request-digest` - the key was used with a different request body. Replay the original unchanged, or read the stored outcome; never "fix" it with a fresh key.
- `stream-advanced` - the Demand's event stream moved while you worked. Read status with the Demand id and continue from what it names.
- `snapshot-stale` - the review snapshot you inspected is no longer current. Inspect the review again and decide on that result.
- `review-unit-stale` - the review unit changed after your inspection (a newer result landed). Inspect again; the decision must cite the current digests.
- `fence-mismatch` - the report carries a claim digest that no recorded outcome of this delivery has: it was written for another delivery. The target imports with the digest from its own delivery prompt - never edit the digest to make it pass.
- `window-claimed` - the window already works on another delivery. Wait for that result or read status; do not release its claim.
- `claim-held` - the window still holds a work claim, so its binding cannot be retired. Let the delivery finish or cancel the Demand first; never release a live claim to get past it.
- `pod-busy` - the pod already carries an active Demand, or an interrupted Demand publication still reserves it. One Demand per pod: complete, cancel or recover that one, or claim into another pod.
- `hook-evidence-missing` - no hook record proves the session named in the observation started in that window. Launch or resume the window with the host procedure, then register again - never register a handle the host did not report.
- `authority-reference-unknown` - the task package cites a ledger member that the Demand's requirement packages do not contain. Use the member references the inspection of the requirement returned.
