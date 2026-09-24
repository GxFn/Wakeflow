---
description: Advance the current Wakeflow Demand by one step - whatever the workspace says is next
argument-hint: "[demand id]"
---

Take the next step on the active Demand.

Load the `wakeflow-controller` skill and follow the "Main flow" section for
whichever step the workspace names; the planning, delivery and review depth is
in its `references/delivery-and-review.md`.

First tool call: `wakeflow_status`, passing a Demand id if the user named one.
Its next actions are the authority on what comes next - do not infer the step
from the conversation.

Then do that one step, and stop. Do not run ahead into the step after it: each
step produces state that the next one has to read.

Report what you did, the evidence Wakeflow recorded for it, and what is now
next. If the next step belongs to the Design window or to a target window, say
so instead of doing it here.
