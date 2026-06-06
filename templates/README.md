# Wakeflow Templates

This directory stores reusable templates for Wakeflow installation, planning,
Design/Test support, and state-machine progress.

## Template Groups

- `starter-workspace/`: ignored runtime starter files for a newly initialized
  parent workspace.
- `wakeflow-state-machine/`: state-root progress, task package, backfill, and
  decision templates.
- `window-support/design/`: internal Design support surface used when no
  external Design repository is configured.
- `window-support/testing/`: internal Test support surface used when no
  external Test repository is configured.

The templates are reusable defaults. Installed workspaces should keep active
state under `.workspace-active/` and long-term project records under
`../workspace-ledger/`.
