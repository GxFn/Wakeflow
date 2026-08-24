# Repository Agent Instructions

<!-- wakeflow:scope:start -->
## Workspace Access Card

This section is maintained by the Wakeflow runtime installer. It records this window access coordinates and the minimum automation gate. Hard rules come from the parent AGENTS and this file; do not duplicate repository-specific rules here.

### Coordinates

- Wakeflow runtime: `../WakeflowFixture`
- Window name: `ProductWindow`
- Parent workspace AGENTS: `../CLAUDE.md`
- Active workspace index: `../WakeflowFixture/.wakeflow-active/index.md`
- Active workspace status: `../WakeflowFixture/.wakeflow-active/current/workspace-current-status.md`
- Current plan directory: `../WakeflowFixture/.wakeflow-active/current`
- Window ledger: `../WakeflowFixture/wakeflow-ledger/ProductWindow`

### When claiming workspace work

1. Read this file first.
2. Then read parent `../CLAUDE.md`.
3. Then read `../WakeflowFixture/.wakeflow-active/index.md` and `../WakeflowFixture/.wakeflow-active/current/workspace-current-status.md`.
4. If there is a current plan, task package, or direct-thread delivery, execute only the content under `../WakeflowFixture/.wakeflow-active/current` explicitly assigned to `ProductWindow`.
5. Goals, scope, forbidden actions, validation commands, and backfill fields come from the current plan, task package, and repository rules. Prompts are only wakeup entrypoints, not the full task specification.
6. If a keyword, familiar command, script hint, or urgency is pulling you into action before a safe operation, recovery boundary, and one-sentence plan are clear, stop and report the blocker.

### Direct Thread Dispatch Minimum Gate

- Direct-thread delivery is the normal work transport. It does not change this window responsibility or expand task scope. Specific work comes from the dispatch packet, current plan, and repository rules.
- Delivery prompts carry one bounded task-focus sentence, navigation/freshness variables (`currentWindow`, `taskId`, `taskPackageId`, `stateRoot`, `stateRevision`, optional `dispatchGroup`), and skill pointers. Do not treat the prompt as a full command manual. The visible `stateRevision` identifies the dispatch snapshot in the packet/envelope; the later delivery-sent event may legitimately advance the live state root. Machine fields such as `controllerWindow`, `returnPolicy`, and `humanContextRef` are read from the state root, dispatch group, and delivery envelope. When an implementation package carries `acceptanceAnchors`, map each anchor to a RED test/probe before coding; an untestable or conflicting anchor is `needs-review`, not permission to invent scope. Stop and report if `stateRoot` is missing or identities conflict.
- This window only handles dispatch packets for `ProductWindow` and returns `TargetResultEnvelope`. Do not claim, accept, or process other window tasks.
- Child windows do not create target-to-target next-hop delivery by default. Evidence repair, redispatch, and next phases are decided by controller review. If delivery has `returnRoute=controller` and `review-results` shows that `DispatchGroup.returnPolicy` allows a callback, create exactly one controller-return envelope per callback scope and `resultVersionKey` with `build-controller-return`, returning by default to the original controller named by `DispatchGroup.controllerWindow`. A legal superseding target result creates a new result version and therefore requires a new controller-return; a transport retry for the same result version reuses its existing envelope. Then complete the real direct-thread send, readback, and `record-delivery-run`. A controller return is complete only when a `DirectThreadDeliveryRun` exists with `status=sent` and `readback.ok=true`. The full group snapshot stays in the controller-return envelope; the visible prompt shows only non-empty exceptional targets and must not treat one target backfill as whole-group completion.
- Non-Test windows must not create, process, or verify Test delivery unless both the current plan and delivery envelope explicitly authorize it.
- Thread ids may only be written to Wakeflow local runtime. Do not write them to tracked documents, backfill text, or GitHub.

### Skill Assistance

- Claude Code subagents (the Task/Agent tool) are recommended for bounded parallel assistance such as code search, log triage, test localization, and evidence summarization. Treat subagent output as evidence or advice only; it must not accept work, dispatch another window, write controller state, or expand repository boundaries.
- Development work uses the plugin execution-craft skill `wakeflow-target-craft` (test-first, systematic debugging, self-review by severity, scope discipline, verify-before-done) so it earns the machine-checkable evidence the controller acceptance gate requires. It loads via the Wakeflow plugin alongside `wakeflow-target`; this window does NOT use the Design or Test windows' built-in skills.

### Functional Completeness Self-Check

Before returning a `TargetResultEnvelope` or handoff, this child window must self-check the assigned feature or evidence path for functional completeness. Do not rely on the controller to discover obvious gaps.

- Re-read the state root, task package, current plan, repository rules, and acceptance/evidence requirements.
- Verify the implementation or evidence covers the requested behavior end to end, including edge cases, integration boundaries, docs/config/API surfaces, and tests that the target window can reasonably run.
- Compare the final diff/evidence against the original user goal and explicit non-goals; do not downgrade a complete capability into a thin adapter, placeholder, mock-only flow, or partial scaffold.
- When recommending follow-up work, label whether it is authorized by the original requirement or only discovered by code/test inspection. Residual implementation fields, existing tests, old adapters, and target observations do not become new requirements unless the original plan, requirement design, or a user/controller decision allows them.
- If completeness cannot be proven inside this window boundary, return `blocked` or `needs-review` with the missing evidence and next recommendation instead of reporting `completed`.

### Document Destinations

- Long-term cross-repository collaboration docs, plans, acceptance records, scans, and boundary records go to `../WakeflowFixture/wakeflow-ledger/ProductWindow`. This repository `docs/` is only for product, release, or user docs maintained with the source.
<!-- wakeflow:scope:end -->
