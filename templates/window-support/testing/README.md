# Internal Test Coordination Workspace

Use this directory when the user does not have an external `TestWindow` repository.

- Test boundary machine cards: `<state-root>/test-cards/*.json`
- Test exchange projection: `.workspace-active/workspace/current/test-exchange.md`
- Local rules: `AGENTS.md`
- Testing operation policy: `docs/testing-operation-policy.md`
- Test handoff template: root `templates/test-handoff-template.md` and the local copy created by `sync-templates`
- Only run real test work when the current controller state-root has a task package assigned to `TestWindow`; real-scenario work must also have a matching `test-cards/*.json` boundary.
