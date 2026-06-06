---
name: wakeflow
description: Use Wakeflow when the user wants unattended, multi-window agent coordination with local state roots, task packages, delivery intents, target result envelopes, and evidence-first controller review. Use for setup, status, packaging work, preparing handoff prompts, importing results, or reviewing an unattended control loop.
---

# Wakeflow

Wakeflow is a local-first control-loop kit. It helps a controller agent manage
multi-window work without pretending scripts can replace judgment.

## Use When

- A task spans multiple agent windows or repositories.
- The user wants unattended or semi-unattended progress.
- You need task packages, result envelopes, and review summaries.
- You need compact prompts for target windows.

## Do Not Use Wakeflow To

- Secretly send prompts to other threads.
- Queue work behind a busy thread.
- Accept target results without reading raw evidence.
- Move product responsibility across repositories.

## Default Flow

1. Clarify the user goal, completion definition, repositories, and first blocker.
2. Run `wakeflow_status` or `node scripts/wakeflow.mjs status`.
3. Create a demand state root if needed.
4. Add one or more target tasks.
5. Prepare delivery intents.
6. Let the host environment perform any real thread send.
7. Record send evidence when available.
8. Import target results.
9. Review and make a controller decision.

## Tool Mapping

Use MCP tools when available:

- `wakeflow_status`
- `wakeflow_init_demand`
- `wakeflow_add_task`
- `wakeflow_prepare_delivery`
- `wakeflow_record_delivery`
- `wakeflow_submit_result`
- `wakeflow_review`

Fallback CLI:

```sh
node scripts/wakeflow.mjs status --json
node scripts/wakeflow.mjs init --demand-key <key> --title <title> --write --json
node scripts/wakeflow.mjs add-task --state-root <stateRoot> --task-id <id> --target-window <window> --summary <summary> --write --json
node scripts/wakeflow.mjs prepare-delivery --state-root <stateRoot> --task-id <id> --dispatch-group <group> --write --json
node scripts/wakeflow.mjs submit-result --state-root <stateRoot> --task-id <id> --target-window <window> --status completed --evidence-ref <ref> --write --json
node scripts/wakeflow.mjs review --state-root <stateRoot> --json
```

## Acceptance Rule

A Wakeflow result is only ready for acceptance when the controller has raw,
reviewable evidence such as a commit hash, command output, report path, runtime
JSON, logs, screenshots, or another concrete artifact reference.
