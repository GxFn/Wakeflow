# Refusals by code and reason

<!-- Generated from the source by `npm run refusals:build`. Do not edit: change the code or the generator's notes, then rebuild. -->

A refusal is the tool telling you why it did nothing. Act on its `code` first; the
`reason` narrows it and `path` names the field or the state concerned. `invalid-request`
is not listed: its `path` and `details.schema` already name the field to fix. `io-failure`
and `unexpected` are failures, not refusals - the skill's rule for them applies. Preview
`blockerCodes` are explained where their tool is (`workspace-maintenance.md`, `windows-and-pods.md`,
`planning-and-delivery.md`, `review-and-completion.md`). A reason written `<like-this>` carries a value in that place.

## `concurrency-conflict` - something changed between your read and this call

A revision, a claim, a binding or a lock is no longer what the request assumed. Do not resend the same call. Read again - `wakeflow_status` (with the Demand id), or the tool's own inspect or preview - take the new revision, digest or generation from that result, and decide whether the call is still wanted. `retryable: true` marks the transient ones (a writer or a lock was busy): after reading status once, the same call may be repeated.

- **delivery**: `stream-revision`
- **demand**: `archive-raced`, `payload-changed`, `publication-<reason>`, `stream-advanced`, `stream-revision`
- **endpoint**: `binding-changed`, `binding-lock`, `claim-changed`
- **evidence**: `demand-root-read-source-changed`
- **kernel**: `claim-state-changed`, `claim-state-exists`, `claim-state-lock-<reason>`, `maintenance-busy`, `operation-scope-<reason>`, `pod-lock-<reason>`
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
- **delivery**: `authority-<reason>`, `binding-changed`, `binding-host`, `binding-missing`, `binding-store`, `callback-phase`, `commit-empty`, `commit-kind`, `decision-rejected`, `fence-mismatch`, `observation-file-content`, `outcome-missing`, `record-<reason>`, `remediation-history`, `remediation-phase`, `requirement-record-<reason>`, `requirement-record-drift`, `rerun-decision`, `rerun-history`, `rerun-phase`, `result-missing`, `rework-decision`, `rework-history`, `rework-phase`, `target-work-type`, `task-package-missing`, `window-unknown`, `worktree-receipt-missing`, `worktree-receipt-stale`
- **demand**: `archive-conflict`, `archive-manifest-digest`, `archive-manifest-missing`, `archive-manifest-schema`, `archive-outcome:<outcome>`, `archive-payload-drift`, `authority-<reason>`, `command-<reason>`, `completion-<reason>`, `completion-route`, `creation-abandoned`, `demand-authority-<reason>`, `demand-root-<reason>`, `demand-root-absent`, `demand-root-drift`, `demand-root-not-directory`, `demand-root-special-node`, `journal-action:<action>`, `ledger-root`, `ledger-root-alias`, `ledger-root-missing`, `package-claim:<status>`, `package-record-absent`, `pod-unknown`, `publication-<reason>`, `terminal-commit-mismatch`, `transaction-<reason>`
- **endpoint**: `binding-drift`, `claim-active`, `claim-drift`, `claim-held`, `closure-blocked`, `handle-changed`, `handle-conflict`, `handle-unchanged`, `hook-evidence-missing`, `launch-intent-drift`, `locator-provider`, `observation-file-content`, `registered-at-not-monotonic`, `relocate-not-applicable`, `worktree-occupied`, `worktree-outside-workspace`, `worktree-repository-unavailable`
- **entrypoints**: `config-<reason>`, `plan-drift`, `runtime-artifact-outdated`, `runtime-artifact-unavailable`, `tool-not-for-role`
- **evidence**: `capacity`, `config-authority`, `demand-authority`, `demand-root-<reason>`, `evidence-commit-missing`, `source-changed`, `source-missing`, `source-root`, `source-type`
- **governance**: `archive-manifest`, `board-unavailable`, `claim-demand-id`, `coverage-reference-drift`, `coverage-task-package-missing`, `ledger-root-missing`, `pod-busy`, `pod-lifecycle-residue`, `pod-publication-residue`, `recovery-demand-identity`, `recovery-plan-drift`, `requirement-member-drift`, `requirement-member-missing`, `requirement-record-drift`
- **kernel**: `active-layout-exists`, `active-layout-node-policy`, `active-layout-not-current`, `claim-<transition>-from-<status>`, `claim-archive-without-claim`, `claim-drift`, `claim-reclaim-other-demand`, `claim-state-chain`, `commit-id-conflict`, `config-authority`, `event-id-conflict`, `idempotency-key-conflict`, `index-anchor`, `maintenance-recovery-required`, `observation-conflict`, `observation-file-<reason>`, `observation-file-content`, `observation-file-digest`, `operation-scope-expired`, `operation-scope-missing`, `operation-scope-promotion`, `operation-scope-root-mismatch`, `plan-blocked`, `plan-drift`, `window-claimed`, `worktree-receipt`, `writer-protocol-unsupported`
- **observation**: `demand-<issue>`, `demands-unavailable`, `ledger-root`, `ledger-root-missing`
- **pod**: `binding-store`, `config-<reason>`, `plan-drift`
- **requirement**: `design-surface-alias`, `design-surface-root`, `ledger-root`, `ledger-root-alias`, `ledger-root-missing`, `plan-drift`, `record-conflict`
- **result-review**: `authority-<reason>`, `binding-changed`, `binding-host`, `binding-missing`, `binding-store`, `commit-empty`, `commit-kind`, `controller-authority`, `decision-rejected`, `delivery-host`, `fence-mismatch`, `lifecycle-<lifecycle>`, `outcome-missing`, `outcome-rejected`, `pod-unknown`, `record-<reason>`, `review-unit-stale`, `task-package-missing`, `window-unknown`, `work-type`, `worktree-branch-required`
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

Finish that operation's recovery before anything else. When `details.tool` is present it names the call that finishes it, even if you called a different tool: call it with `mode: recover` and the id the refusal gives (`operationId` = `details.operationId`; for `wakeflow_record_evidence`, `demandId` = `details.demandId`); `wakeflow_maintain_workspace` without an `operationId` means preview and apply `reconcile`. Then repeat the refused call or read status again - the next refusal or `next` names the step after. Without `details.tool`: for maintenance, `details.operationId` goes to maintenance recover and, without one, preview reconcile; a requirement publish or a Demand create that was cut short is finished by sending the same request again (once the package shows as claimed, by `mode: recover` with the id of that Demand instead); the other Demand tools and the evidence and pod tools take `mode: recover` themselves, with the operation the refusal names. See "Interrupted writes and cancellation" in `workspace-maintenance.md`.

- **demand**: `append-candidates-pending`, `claim-state-vanished`, `demand-publication`, `demand-root-and-archive-absent`, `demand-root-restore`, `demand-root-vanished`, `evidence-publication-pending`, `journal-invalid`, `journal-verify-missing`, `lifecycle-journal-pending`
- **endpoint**: `binding-store`
- **pod**: `config-<reason>`
- **requirement**: `claim-state-vanished`, `ledger-publication`, `record-vanished`
- **workspace**: `maintenance-gate-residue`, `maintenance-recovery-artifact-mismatch`

## Reasons where the first instinct is wrong

- `request-digest` - the key was used with a different request body. Replay the original unchanged, or read the stored outcome; never "fix" it with a fresh key.
- `stream-advanced` - the Demand's event stream moved while you worked. Read status with the Demand id and continue from what it names.
- `review-unit-stale` - the review unit changed after your inspection (a newer or superseding result landed, or it was already decided). Inspect again; the decision must cite the current `reviewUnitDigest`. Recording evidence or another target moving does not cause this.
- `fence-mismatch` - the report carries a claim digest that no recorded outcome of this delivery has: it was written for another delivery. The target imports with the digest from its own delivery prompt - never edit the digest to make it pass.
- `window-claimed` - the window already works on another delivery. Wait for that result or read status; do not release its claim.
- `binding-changed` - the window was replaced after this permit was issued, so its envelope can no longer be recorded against or re-armed. For a delivery already recorded as rejected before send, prepare the target again: a replaced window gets a new envelope at once, without using up the re-arms, and the new prompt names the current binding.
- `claim-held` - the window still holds a work claim, so its binding cannot be retired. Let the delivery finish or cancel the Demand first; never release a live claim to get past it.
- `pod-busy` - the pod already carries an active Demand, or an interrupted Demand publication still reserves it. One Demand per pod: complete, cancel or recover that one, or claim into another pod.
- `hook-evidence-missing` - no hook record proves the session named in the observation started in that window. Launch or resume the window with the host procedure, then register again - never register a handle the host did not report.
- `lifecycle-journal-pending` - a complete, cancel or continue of this Demand was cut short. `details.tool` names which one - it may not be the tool you called; recover with it before anything else on this Demand.
- `append-candidates-pending` - an event append on this Demand was cut short. Preview and apply `reconcile`, then repeat the call - it may then name a second step.
- `evidence-publication-pending` - an evidence recording on this Demand was cut short. Call `wakeflow_record_evidence` with `mode: recover` and `demandId` = `details.demandId` (this tool's recover takes no `operationId`), then repeat the call.
- `demand-publication` - the creation of this Demand was cut short. With `details.tool`, recover with `wakeflow_create_demand` and the Demand id. Without it the create tool itself refused (apply or `mode: recover`): a writer of that creation may still be running - wait, then send the same request again.
- `creation-abandoned` - this unfinished creation could never claim its requirement package (`details.packageStatus`: withdrawn, or claimed by another Demand), so its recover removed the unclaimed Demand root and the pod is free. Nothing is left to recover: do not retry - create from a package that is pending.
- `authority-<reason>` - the Demand, or the configuration behind it, could not be opened for this call. With `demand-authority` the Demand may be stopped on an interrupted write: read `wakeflow_status` with its `demandId` before retrying - a `demand-recovery` route there names the recover call.
- `authority-reference-unknown` - the task package cites a ledger member that the Demand's requirement packages do not contain. Use the member references the inspection of the requirement returned.
