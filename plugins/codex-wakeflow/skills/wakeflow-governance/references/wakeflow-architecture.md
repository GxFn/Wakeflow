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
| MCP tools | stable outer capability interface for workspace setup, status, state roots, packages, delivery envelope preparation/recording, review packs, controller decisions, Design/Test intake, next-work scans, archive actions, and verification |
| scripts | local implementation backend for file/state operations, result import/reduction, controller-return construction, archive internals, keep-live state, and backend checks |
| templates | reusable starter surfaces for installed workspaces |
| `.wakeflow-active/` | ignored active runtime state |
| `.wakeflow-local/` | ignored local config and real thread ids |
| `../wakeflow-ledger/` | project-specific long-term records |

## MCP Boundary

MCP tools organize only the outer agent workflow. They do not directly
manipulate real thread ids, fake host sends, expose every runtime script, or
decide acceptance. Target closeout stays split into narrow actions: record the
target result envelope, review readiness, prepare a controller-return envelope
when policy allows, send with the Codex host thread tool, and record delivery
evidence. Internal runtime scripts remain available to Wakeflow skills and tests
without becoming public MCP tools.

In installed plugin workspaces, total-control agents must treat those scripts as
backend implementation details. They use Wakeflow MCP tools for setup, status,
state roots, delivery, archive, next-work scans, and verification. If the MCP
surface is unavailable, they stop and report the plugin-surface blocker instead
of constructing cache paths or guessing script parameters.

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
