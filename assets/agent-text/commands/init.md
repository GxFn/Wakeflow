---
description: Initialize a Wakeflow workspace here, or bring an existing one back to what its configuration implies
argument-hint: "[program name]"
---

Set up or repair the Wakeflow workspace for this directory.

On a directory without a workspace, read that skill's `references/first-run.md`
before asking anything: the session you are in only bootstraps and never
becomes the Controller; it ends with the handover card.

Load the `wakeflow-controller` skill and follow its "Step 0 - Initialize or
maintain the workspace" section; the depth is in its
`references/workspace-and-windows.md`.

First tool call: `wakeflow_maintain_workspace` in preview, after you have asked
the user for the choices the intent needs (program identity, repositories,
surfaces, storage root) - on an existing workspace, preview the reconcile
intent instead and report what it found. The fresh-initialize `selection` has
six parts - `program`, `presentation`, `topology` (repositories, support
surfaces, windows), `storage`, `governance`, `hosts` - and its exact shape is
the tool's input schema in your tool list: build the request from that schema,
never from plugin files on disk. A refusal names the failing path and rule
(`details.schema`, for example `required:storage`); fix that field and preview
again. Recommend `owner-managed` for every repository unless the user asks for
Wakeflow's managed block, and say that a committed block is seen by every
clone. `fresh-legacy-residue-present` lists what it found as
`fresh-legacy-residue-<kind>` codes; the user removes residue themselves - a
sibling `../wakeflow-ledger` directory that is another workspace's live ledger is not residue. Residue listed under a repository root is removed by the user before a window is launched there. When the user wants to add a product
repository to an existing workspace, preview the reconfigure intent the
reference describes for that. The directory must already be a Git repository
of its own; if the preview reports `gitignore-git-repository`, tell the user,
run `git init` there yourself once they agree, and preview again.

Preview writes nothing. Show the user the plan and every blocker it returned,
apply only with exactly what that preview returned, and only after they say to.

Then continue with "Step 1 - Open windows and register their bindings": launch
each window the result asks for and register what you observed with
`wakeflow_register_window_binding`.
