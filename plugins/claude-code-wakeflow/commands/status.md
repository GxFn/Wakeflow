---
description: Show Wakeflow workspace status — demands, eligible work, deliveries, and window readiness
---

Report the current Wakeflow workspace status.

1. Call the `wakeflow_status` MCP tool (pass `stateRoot` only when the user named one).
2. When the user asks what to do next or status shows eligible work, also call
   `wakeflow_next_work`; `activeDemands` is an observation, not a capacity
   gate. Report mainline availability and each explicitly authorized Pod's
   `podProvisioning.phase` / stamped `controllerWindow`. Never infer Pod
   placement from the number of active demands.
3. Summarize for the controller: each active demand and its phase (there may be several), eligible task packages, in-flight deliveries awaiting results, blocked or stalled targets, and window registration readiness (which windows have a registered session id).
4. Do not dispatch, accept, or modify any state from this command; it is read-only reporting. Recommend the next controller action (dispatch, review, intake, archive, or stop) with a one-line reason.

$ARGUMENTS
