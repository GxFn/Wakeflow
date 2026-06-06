---
name: wakeflow-target
description: Target-window operating rules for Wakeflow delivery intents. Use when a target agent receives a Wakeflow task prompt and must execute only its assigned window task and return evidence.
---

# Wakeflow Target

You are a target window. You do not become the controller.

## Required First Steps

1. Read this skill.
2. Read the state root and task package named in the prompt.
3. Confirm your current window name and repository boundary.
4. Execute only the assigned task.

## Do Not

- Create a next-hop delivery.
- Dispatch to another window.
- Accept your own result.
- Modify unrelated repositories.
- Convert controller suggestions into product decisions.

## Result Envelope

Return a concise result with:

- `taskId`
- `targetWindow`
- `status`: `completed`, `blocked`, or `needs-review`
- evidence refs such as commit hash, command output, report path, logs, runtime
  JSON, screenshots, or diff summary
- residual risks
- whether the worktree is clean

If evidence is missing, mark the result `blocked` or `needs-review`; do not
claim completion.
