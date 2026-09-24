---
description: Create a Wakeflow pod for parallel work, or close one after its branch has been merged or abandoned
argument-hint: "create|close [pod name]"
---

Create or close a Wakeflow pod.

Load the `wakeflow-controller` skill and follow its "Step 13 - Close the pod"
section; the full create and close procedure is in its
`references/workspace-and-windows.md`.

First tool call: `wakeflow_pod` in preview, for the create or close intent the
user asked for. Preview writes nothing; show the user the plan before applying
it with exactly what preview returned.

On create: one config transaction registers the pod's window set and one
worktree intent per repository. Creating the worktrees and launching the
windows are your host actions, and each window must then be registered.

On close: the pod's Demand must already be archived and the user must have
merged or abandoned its branch. Record the branch dispositions truthfully -
never record a branch as merged that you have not seen merged - then retire the
windows, remove the checkouts, and remove the pod in that order.
