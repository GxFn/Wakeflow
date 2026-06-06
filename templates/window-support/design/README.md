# Internal Design Workspace

Use this directory when the user does not have an external `DesignWindow` repository.

- Handoff board: `.workspace-active/workspace/current/design-handoff-board.md`
- Local rules: `AGENTS.md`
- Operating policy: `docs/design-window-operating-policy.md`
- Alignment checklist: `docs/workspace-alignment-checklist.md`
- Templates: root `templates/` and the local copies created by `sync-templates`
- Discovery command: `node scripts/import-design-handoffs.mjs --write`
- Control intake command after total-control acceptance: `node scripts/control-intake.mjs design-handoff --state-root <state-root> --design-key <Design Key> --write --json`
