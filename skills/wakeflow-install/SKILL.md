---
name: wakeflow-install
description: Install or validate Wakeflow as a Codex plugin with manifest, skills, MCP helper, assets, and local runtime boundaries.
---

# Wakeflow Install

Use this skill when creating, validating, or updating the Wakeflow plugin.

## Expected Shape

```text
.codex-plugin/plugin.json
.mcp.json
skills/
bin/wakeflow-mcp.mjs
scripts/wakeflow.mjs
lib/wakeflow-state.mjs
templates/
assets/
```

## Validation

Run:

```sh
npm test
python3 /Users/gaoxuefeng/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

The plugin must not require network access or dependency installation for its
core validation and smoke test.

## Local Runtime

Wakeflow writes local demand state under `.wakeflow/`, which must remain ignored
by Git. Real thread ids, if a future host adapter records them, must stay local.
