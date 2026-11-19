---
description: Turn one sentence into a small Wakeflow Demand for one repository, with a single confirmation
argument-hint: "<what to change> [in which repository]"
---

Start a quick Demand for a small change in one repository.

Load the `wakeflow-controller` skill and follow "Quick Demand" in its
`references/planning-and-delivery.md`. Use it only when the request fits: one
repository, one implementation task, nothing that needs a design conversation
or a separate test target. Otherwise say so and send the user to the Design
window.

First tool call: `wakeflow_status` (`detail: "summary"`). It names the
repositories and tells you whether the workspace is idle; a quick Demand needs
an idle workspace. If the user did not name the repository and more than one
could be meant, ask.

Then `wakeflow_quick_demand` with `mode: "preview"`: the repository, a short
title, the user's request in their own words, and one line per criterion in
`doneWhen` when they said how they will know it is done. Nothing is written.
Show the user the title, the goal and the criteria from the preview and ask
once. A blocker is reported as it is; do not work around it.

After they confirm, call it again with `mode: "apply"`, the preview's
`planDigest` and `confirmation.confirmedAt`. Send the permit in `delivery` to
the product window exactly as for any delivery and record the outcome. When
the result comes back, review it as usual and accept with `thenComplete: true`
so the Demand is archived in the same call.

Report what was created and, at the end, the archived Demand's page. If a step
stopped (`stoppedAt`), say which and continue with the ordinary tool for that
step.
