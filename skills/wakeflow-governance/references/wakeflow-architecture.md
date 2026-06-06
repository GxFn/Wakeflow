# Wakeflow Architecture Reference

## Product Shape

Wakeflow is both:

- a reusable local workflow runtime with scripts, templates, schemas, skills,
  state roots, delivery envelopes, result envelopes, ledgers, and verification;
- a Codex plugin that exposes skills and MCP tools over that runtime.

It is not a product source repository and not a replacement for controller
judgment.

## Layers

| Layer | Responsibility |
| --- | --- |
| `AGENTS.md` | hard gates, controller identity, repository boundaries, confirmation gates, testing boundaries, acceptance floor |
| skills | operation steps, commands, field templates, examples, troubleshooting |
| MCP tools | stable capability interface for workspace setup, status, state roots, packages, delivery, results, review, archive, verification |
| scripts | local implementation backend for file/state operations |
| templates | reusable starter surfaces for installed workspaces |
| `.workspace-active/` | ignored active runtime state |
| `.workspace-local/` | ignored local config and real thread ids |
| `../wakeflow-ledger/` | project-specific long-term records |

## MCP Boundary

MCP tools organize local file/state operations. They do not directly manipulate
real thread ids, fake host sends, or decide acceptance. Codex host thread tools
perform real sends; Wakeflow records envelopes and send/readback evidence.

## Installed Workspace Shape

```text
ParentWorkspace/
  AGENTS.md
  Wakeflow/
  ProductRepo/
  DesignRepo/
  TestRepo/
  wakeflow-ledger/
```

Product repositories remain siblings. Active state and local runtime files are
ignored. Long-term project records live outside the reusable Wakeflow repo.
