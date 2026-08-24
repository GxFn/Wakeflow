# Repository Agent Instructions

<!-- wakeflow:scope:start -->
## Workspace Access Card

This managed block provides stable identity and authority boundaries. Detailed execution procedure comes from the assigned task package and matching Wakeflow Skills.

### Coordinates

- Wakeflow runtime: `../WakeflowFixture`
- Window name: `ProductWindow`
- Parent workspace CLAUDE: `../CLAUDE.md`
- Active workspace index: `../WakeflowFixture/.wakeflow-active/index.md`
- Active workspace status: `../WakeflowFixture/.wakeflow-active/current/workspace-current-status.md`
- Current plan directory: `../WakeflowFixture/.wakeflow-active/current`
- Window ledger: `../WakeflowFixture/wakeflow-ledger/ProductWindow`

<!-- wakeflow:rule:WF-IDENTITY -->
## Identity and first read

- This repository serves `ProductWindow`. Read this file, parent `../CLAUDE.md`, `../WakeflowFixture/.wakeflow-active/index.md`, and `../WakeflowFixture/.wakeflow-active/current/workspace-current-status.md` first.
- For active work, read only the state root and task package under `../WakeflowFixture/.wakeflow-active/current` assigned to `ProductWindow`. The prompt is a wakeup/navigation aid, not the full specification.
- Stop if the state root, task/package identity, repository mapping, or required Skill is missing, stale, or contradictory.

<!-- wakeflow:rule:WF-REPOSITORY-BOUNDARY -->
## Repository boundary

- Work only in this repository for the assigned `ProductWindow` package. The exact runtime cwd belongs in the local dispatch envelope, not this tracked access card. Do not claim another window's work or cross into another repository.
- Before returning a result, compare the diff and validation against the original objective, explicit non-goals, acceptance anchors, integration boundaries, and repository rules.
- If functional completion cannot be supported inside this boundary, return `blocked` or `needs-review`; do not report completion and rely on total control to find obvious gaps.

<!-- wakeflow:rule:WF-STATE-AUTHORITY -->
## State authority

- `controller-events.jsonl` and `wakeflow-state.json` are controller-owned facts. Prompts, progress Markdown, transport claims, and target self-reports are not acceptance or state authority.
- Write target results and controller returns only through the assigned Wakeflow Skill/tool surface. Thread ids and host receipts remain local runtime data.

<!-- wakeflow:rule:WF-DEMAND-FREEZE -->
## Demand freeze gate

- Execute only the frozen demand authority and assigned task package. Do not infer new requirements from existing code, tests, adapters, or discovered follow-up work.
- Map each acceptance anchor to a concrete RED probe before implementation. An untestable/conflicting anchor requires `needs-review`, not invented scope.

<!-- wakeflow:rule:WF-TEST-GATE -->
## Test gate

- Non-Test windows must not create, process, or verify Test delivery unless both the current plan and delivery envelope explicitly authorize it.

<!-- wakeflow:rule:WF-DESTRUCTIVE-RELEASE-GATE -->
## Destructive and release gate

- Do not reset, revert, delete user work, rewrite history, mutate unrelated repositories, or bypass state/authority gates without explicit user authorization.
- Commit, push, tag, publish, release, cache refresh, and destructive cleanup require explicit authorization.

<!-- wakeflow:rule:WF-SKILL-ROUTING -->
## Skill routing

- Use `wakeflow-target` for delivery receipt, bounded execution, TargetResultEnvelope, and controller return.
- For implementation/rework, load both `wakeflow-target` and `wakeflow-target-craft`; acceptance anchors become RED probes before coding.
- Detailed transport, readback, retry, Pod, and archive procedures live in the matching Skill/reference; do not reconstruct them from this memory file.

## Document destinations

- Demand definitions, requirement deltas, test-environment specifications, and confirmed boundaries go to `../WakeflowFixture/wakeflow-ledger/requirement-designs/`; these are the only durable documents that may become demand-authority anchors.
- Goal/stage confirmations and cross-window execution decisions go to `../WakeflowFixture/wakeflow-ledger/goal-stage-confirmation/`.
- Workspace-wide plans, policies, acceptance records, scans, and boundary records go to `../WakeflowFixture/wakeflow-ledger/workspace/` and stay indexed by the workspace record map.
- This window's responsibility-specific operating history and handoffs go to `../WakeflowFixture/wakeflow-ledger/ProductWindow/`; do not place demand definitions there.
- Current projections and state roots live under `../WakeflowFixture/.wakeflow-active/current/`; do not use active runtime as a durable document library.
- `../WakeflowFixture/.wakeflow-local/` is machine-local runtime only, never an authoring destination.
- This repository `docs/` is only for product, release, or user documentation maintained with the source.
<!-- wakeflow:scope:end -->
