---
description: Prepare one exact Wakeflow v3 target delivery and execute it only through the v3 Claude transport seam
argument-hint: "[target-task-id]"
---

Run one controller dispatch step through the wakeflow-controller Skill.

1. Confirm this is the demand's stamped Controller and select one eligible
   typed target task. Do not infer a Pod/controller from a title.
2. Call `wakeflow_prepare_delivery operation=target-preview`. Review the exact
   current state, binding, repository, TaskPackage, prompt, plan, and digest.
   Preview is zero-write.
3. After confirming it, call `operation=target-apply` with the exact returned
   plan/digest. Apply writes immutable group/packet/envelope transport only.
4. Immediately before the host effect call `operation=target-claim` with the
   exact current binding/envelope tuple. A stale or conflicting lease stops the
   dispatch.
5. Route the effect through the packaged v3 Claude host facade's exact
   `target-delivery` command. Its transport owner holds the stable-window
   operation mutex across validation, physical paste, and at most one bounded
   readback. Retired public-v2 `deliver`/registry commands are not aliases; if
   exact host execution or its receipt is unavailable, stop and report the
   blocker.
6. Record the observed fact with `wakeflow_record_delivery
   operation=target-outcome`. The recorder is not the host-effect fence.
7. End the turn. Accepted, ambiguous, or sent-unconfirmed transport is never
   resent. Only a proved rejected-before-send flow may later use
   `wakeflow_prepare_delivery operation=target-rearm`.

Never poll for completion, delete a lease file, or release by semantic window
name. Controller-return has its own preview/apply/pre-send path and takes no
target lease.

$ARGUMENTS
