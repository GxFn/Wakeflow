# Current Design Work

Use this directory for active Design drafts that still belong to the Design
surface:

- `<topic>-original-plan-YYYY-MM-DD.md`
- `<topic>-requirement-design-YYYY-MM-DD.md`
- `<topic>-workspace-signal-YYYY-MM-DD.md`
- `<topic>-workspace-handoff-YYYY-MM-DD.md`

Design drafts are not executable controller plans and are not durable demand authority. When the design is confirmed, promote the demand-defining files into `wakeflow-ledger/requirement-designs/<demand-key>/`; then delivery or controller-inline creation may freeze anchors to those promoted files. Do not freeze `docs/current/` or a per-window ledger as demand authority.

Do not store product source changes, runtime test evidence, secrets, real
thread ids, or controller machine state here.
