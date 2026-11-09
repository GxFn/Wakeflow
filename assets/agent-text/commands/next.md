---
description: Advance the current Wakeflow Demand through the Controller's own steps until a stop point
argument-hint: "[demand id]"
---

Advance the active Demand through the steps that belong to the Controller.

Load the `wakeflow-controller` skill and follow the "Main flow" section for
whichever step the workspace names; the planning, delivery and review depth is
in its `references/delivery-and-review.md`.

First tool call: `wakeflow_status`, passing a Demand id if the user named one.
Its next actions are the authority on what comes next - do not infer the step
from the conversation.

Before each step, say in one sentence which safe operation you are about to
perform; the urge to act is a hard stop until that sentence exists. Then do the
step, and read `wakeflow_status` again before the next one: each step produces
state that the next one has to read.

Keep going while the owner of `next` is the Controller. Stop and report at the
first of these: the owner changes and nothing you own is ready (after the last
pending delivery lands it is the target windows; before a claim it is Design or
the user); the skill asks for the user's confirmation or decision; a preview
reports a blocker you cannot resolve. A recorded decision or a recorded
delivery outcome is a step boundary, not a stop: read `wakeflow_status` again
and go on while it names you - the next target to plan or deliver, a review
unit that landed meanwhile, the completion preview. A fresh Controller session
may take over at any step boundary: the state is in Wakeflow, not in this chat;
the user can queue a message at any time and you read it at the next boundary.

Report what you did, the evidence Wakeflow recorded for it, and what is now
next. If the next step belongs to the Design window or to a target window, say
so instead of doing it here.
