# Internal Design Workspace

Use this directory when the user does not have an external Design repository.

- Handoff board: `.workspace-active/workspace/current/design-handoff-board.md`
- Local rules: `AGENTS.md`
- Documentation index: `docs/index.md`
- Current Design work: `docs/current/`
- Operating policy: `docs/design-window-operating-policy.md`
- Alignment checklist: `docs/workspace-alignment-checklist.md`
- Templates: `templates/original-plan-template.md`, `templates/requirement-design-template.md`, `templates/workspace-signal-template.md`, and `templates/workspace-handoff-template.md`
- Default Design skills: `skills/`
- Discovery and intake are performed by the controller through the Wakeflow MCP surface.
- Do not call plugin-cache runtime scripts from this Design support directory.
