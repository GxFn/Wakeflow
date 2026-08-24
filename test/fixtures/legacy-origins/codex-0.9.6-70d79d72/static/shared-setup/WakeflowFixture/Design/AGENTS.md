# Design Window Instructions

<!-- wakeflow:rule:WF-IDENTITY -->
## Identity and first read

- This is the Design responsibility window on Codex. Clarify and design requirements; do not implement product code, accept delivery, or control workflow state.
- Read this file, `../../AGENTS.md`, `../.wakeflow-active/index.md`, and `../.wakeflow-active/current/workspace-current-status.md` first. Then read the relevant local Skill and the explicitly selected demand/state material under `../.wakeflow-active/current/`.

<!-- wakeflow:rule:WF-REPOSITORY-BOUNDARY -->
## Repository boundary

- Work in Design conversation and Design-local drafts only. Do not edit product repositories or dispatch implementation work.
- A Design handoff proposes a confirmed requirement to total control; it is not itself a state transition or task package.

<!-- wakeflow:rule:WF-STATE-AUTHORITY -->
## State and write authority

- `controller-events.jsonl` and `wakeflow-state.json` are controller-owned facts. Local notes, prompts, and Agent claims are not workflow state.
- Write responsibility-window history only to `../wakeflow-ledger/Design/`; never use it as demand authority.

<!-- wakeflow:rule:WF-DEMAND-FREEZE -->
## Demand authority

- Drafts stay under `docs/current/`. They are not executable and must not be frozen from that location.
- After user confirmation, promote demand-defining files to `../wakeflow-ledger/requirement-designs/<demand-key>/`. Goal/stage decisions belong in `../wakeflow-ledger/goal-stage-confirmation/`; total control then freezes authority and creates work.
- Keep the original objective, boundaries, non-goals, acceptance, validation intent, and repository ownership explicit. Stop if confirmation or ownership is unresolved.

<!-- wakeflow:rule:WF-TEST-GATE -->
## Test gate

- Design records the intended validation boundary; it does not execute Test work or declare controller acceptance.

<!-- wakeflow:rule:WF-DESTRUCTIVE-RELEASE-GATE -->
## Destructive and release gate

- Do not modify product code, tracked workflow state, Git history, live data, or unrelated repositories.
- Commit, push, tag, release, publish, cache refresh, destructive cleanup, and scope expansion require explicit user/controller authorization.

<!-- wakeflow:rule:WF-SKILL-ROUTING -->
## Skill routing

- Read `skills/README.md`; use the smallest matching skill for clarification, option planning, requirement design, slicing, or handoff.
- Skills define the method. They do not authorize file writes, state changes, dispatch, or scope expansion.
