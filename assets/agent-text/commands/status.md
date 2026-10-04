---
description: Report the Wakeflow workspace state, what is next and who owns it, and verify it strictly when something looks wrong
argument-hint: "[demand id]"
---

Report where this Wakeflow workspace stands.

Load the `wakeflow-controller` skill and follow its "Checking the workspace"
section. `runtime-artifact-outdated` / `server-outdated` describe this serving
MCP process. `window-runtime-unverified` describes missing peer runtime evidence,
not a proven stale process. Load the current skill and follow "After a plugin
update"; do not infer MCP readiness from SessionStart or Stop records.

First tool call: `wakeflow_status`, passing a Demand id if the user named one,
to attach that Demand's route or its archive receipt.

Report in the user's terms: the overall state, what is on the board, the active
Demand and its frontier, any window that is not registered, any work claim that
is held, and the next actions the result named - with who owns each one.

Run `wakeflow_verify` as well when the status contradicts itself, when a
delivery looked sent but no evidence arrived, or when the user asks whether the
workspace is sound. It repairs nothing; report each gate that did not pass, and
report an unavailable gate as unchecked rather than as passing.
