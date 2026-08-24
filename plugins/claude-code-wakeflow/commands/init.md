---
description: Preview and apply a fresh Wakeflow v3 workspace initialization
---

Initialize the current workspace with the public v3 maintenance owner.

1. Build one explicit closed `selection` covering `program`, `topology`,
   `storage`, `governance`, and `hosts`. Repository/support/window entries link
   with request-local `selectionKey`; do not invent durable IDs or infer
   Design/Test from similar directory names.
2. Call `wakeflow_maintain_workspace` with `action: "fresh-initialize"`,
   `mode: "preview"`, the workspace root, the complete selection, and the
   user's language. Preview is read-only.
3. Show the user the exact managed surfaces, blockers, `launchIntents`, and
   confirmed plan boundary. Wait for explicit confirmation.
4. Apply with the same root/action, `mode: "apply"`, and the exact
   `confirmedActionPlan` plus `confirmedActionPlanDigest` returned by preview.
   Never reconstruct or edit the plan.
5. If apply reports recovery-required, call the same action with
   `mode: "recover"`, the exact plan/digest, and named `operationId`.
6. Report created/verified surfaces and retained launch intents. Do not
   dispatch work from initialization.

An existing strict v3 workspace uses `reconfigure` for an intentional desired
model change or `reconcile` to restore managed bytes/projections. There is no
reset/discovery/useDiscovered alias. A recognized legacy workspace requires the
explicit unregistered bootstrap path and separate user authorization; `/init`
must not import or delete legacy state.

`launchIntents` are host-neutral authority. Route them through the packaged v3
Claude host facade's exact `launch-window` command, then register the final
real session with `wakeflow_register_window operation=register`. Retired
public-v2 window-host/thread-registry commands are not aliases. If the exact
host effect or receipt is unavailable, report the intents and stop without
writing substitute runtime.

If the Wakeflow MCP surface is unavailable, stop for plugin reload/reinstall;
do not invoke backend scripts or cache paths directly.

$ARGUMENTS
