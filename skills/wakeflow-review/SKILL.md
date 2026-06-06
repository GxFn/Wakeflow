---
name: wakeflow-review
description: Review Wakeflow target results and decide whether a control-loop demand can continue, needs rework, is blocked, or is complete.
---

# Wakeflow Review

Review is a controller action, not a script action.

## Review Steps

1. Run `wakeflow_review` or `node scripts/wakeflow.mjs review`.
2. For every completed target, read the raw evidence refs.
3. Check whether the evidence proves the assigned task, not a nearby task.
4. Check remaining pending, missing, blocked, or deferred targets.
5. Decide one of:
   - accept and create the next eligible task,
   - rework,
   - blocked pending user or upstream evidence,
   - complete the demand,
   - stop because there are no eligible tasks.

## Evidence Checklist

Prefer concrete evidence:

- commit hash,
- diff summary,
- command output,
- test report path,
- runtime JSON,
- logs,
- screenshots,
- clean/dirty worktree status.

Do not close a Wakeflow demand from natural-language confidence alone.
