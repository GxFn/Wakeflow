# Internal Test Coordination Workspace

Use this directory when the user does not have an external Test repository.

- Test boundary machine cards: `<state-root>/test-cards/*.json`
- Test exchange projection: `.wakeflow-active/current/test-exchange.md`
- Local rules: `AGENTS.md`
- Documentation index: `docs/README.md`
- Current Test work: `docs/current/`
- Default config: `config/defaults.json`
- Test-owned scripts: `scripts/`
- Test skill map: `skills/README.md`
- Test skills are evidence methods first. Use them proactively to plan
  validation, triage failures, design regressions, review evidence, and handle
  long-chain validation before recording backfill.
- Testing operation policy: `docs/testing-operation-policy.md`
- Test handoff template: `templates/test-handoff-template.md`
- Rule: only run real test work when a controller state root assigns a matching task package and test card.
