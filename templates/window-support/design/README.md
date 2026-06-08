# Internal Design Workspace

Use this directory when the user does not have an external Design repository.

- Handoff board: `.workspace-active/workspace/current/design-handoff-board.md`
- Local rules: `AGENTS.md`
- Documentation index: `docs/index.md`
- Current Design work: `docs/current/`
- Operating policy: `docs/design-window-operating-policy.md`
- Alignment checklist: `docs/workspace-alignment-checklist.md`
- Templates: `templates/original-plan-template.md`, `templates/requirement-design-template.md`, `templates/workspace-signal-template.md`, and `templates/workspace-handoff-template.md`
- Design skill map: `skills/README.md`
- Design skills are conversational methods first. Use them to clarify,
  compare, draft, slice, and prepare handoff recommendations with the user
  before writing tracked documents.
- Discovery and intake are performed by the controller through the Wakeflow MCP
  surface. Design does not run plugin-cache runtime scripts or update intake
  state directly.
- Do not call plugin-cache runtime scripts from this Design support directory.
