# Internal Design Workspace

Use this directory when the user does not have an external Design repository.

- Handoff board: `.workspace-active/workspace/current/design-handoff-board.md`
- Local rules: `AGENTS.md`
- Documentation index: `docs/index.md`
- Current Design work: `docs/current/`
- Operating policy: `docs/design-window-operating-policy.md`
- Alignment checklist: `docs/workspace-alignment-checklist.md`
- Templates: `templates/original-plan-template.md`, `templates/requirement-design-template.md`, `templates/workspace-signal-template.md`, and `templates/workspace-handoff-template.md`
- Discovery command: `node scripts/wakeflow-import-design-handoffs.mjs --write`
- Control intake command after total-control acceptance: `node scripts/wakeflow-intake.mjs design-handoff --state-root <state-root> --design-key <Design Key> --write --json`
