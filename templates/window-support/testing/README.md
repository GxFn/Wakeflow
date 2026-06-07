# Internal Test Coordination Workspace

Use this directory when the user does not have an external Test repository.

- Test boundary machine cards: `<state-root>/test-cards/*.json`
- Test exchange projection: `.workspace-active/workspace/current/test-exchange.md`
- Local rules: `AGENTS.md`
- Documentation index: `docs/README.md`
- Current Test work: `docs/current/`
- Default config: `config/defaults.json`
- Test-owned scripts: `scripts/`
- Default Test skills: `skills/`
- Testing operation policy: `docs/testing-operation-policy.md`
- Test handoff template: `templates/test-handoff-template.md`
- Only run real test work when the current controller state-root has a task package assigned to `Test` or the configured test window; real-scenario work must also have a matching `test-cards/*.json` boundary.
