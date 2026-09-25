---
description: Initialize a Wakeflow workspace here, or bring an existing one back to what its configuration implies
argument-hint: "[program name]"
---

Set up or repair the Wakeflow workspace for this directory.

Load the `wakeflow-controller` skill and follow its "Step 0 - Initialize or
maintain the workspace" section; the depth is in its
`references/workspace-and-windows.md`.

First tool call: `wakeflow_maintain_workspace` in preview, after you have asked
the user for the choices the intent needs (program identity, repositories,
surfaces, storage root) - on an existing workspace, preview the reconcile
intent instead and report what it found. When the user wants to add a product
repository to an existing workspace, preview the reconfigure intent the
reference describes for that. The directory must already be a Git repository
of its own; if the preview reports `gitignore-git-repository`, ask the user to
run `git init` there and preview again.

Preview writes nothing. Show the user the plan and every blocker it returned,
apply only with exactly what that preview returned, and only after they say to.

Then continue with "Step 1 - Open windows and register their bindings": launch
each window the result asks for and register what you observed with
`wakeflow_register_window_binding`.
