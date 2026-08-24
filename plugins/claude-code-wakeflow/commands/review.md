---
description: Inspect strict Wakeflow v3 review inputs, validate independently, and record one exact decision
argument-hint: "[dispatch-group-id]"
---

Run one controller review step through the wakeflow-controller Skill.

1. Confirm this is the demand's stamped Controller and resolve one exact
   current dispatch group.
2. Call `wakeflow_review_pack operation=group`. Inspect the strict current
   transport/result classification and every target-authored input. Historical
   or old-envelope results are trace only.
3. Independently inspect/rerun the evidence needed for the requirement. A
   result, Test report, or script success is not acceptance.
4. When ready, call `wakeflow_reduce_results operation=create` to create one
   exact pending ReviewCandidate. It is not a verdict.
5. Call `wakeflow_decide_review operation=decide` with one allowed decision:
   accept, rework, redesign, or blocked. Recompute and revalidate current
   authority; do not trust cached candidate fields.
6. Complete the demand only through `wakeflow_complete_demand
   operation=preview`, followed by exact `apply` after reviewing its lifecycle
   plan. Archive remains a later whole-demand owner.
7. Report evidence, decision, residual risk, and next eligible step.

Use `wakeflow_review_pack operation=trace` only for evidence tracing. It never
provides a next-action authority or repairs corrupt transport.

$ARGUMENTS
