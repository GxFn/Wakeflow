# Wakeflow Architecture Reference

## Product Shape

Wakeflow is both:

- a reusable local workflow runtime with scripts, templates, schemas, skills,
  state roots, delivery envelopes, result envelopes, ledgers, and verification;
- a Claude Code plugin that exposes skills and MCP tools over that runtime.

It is not a product source repository and not a replacement for controller
judgment.

## Layers

| Layer | Responsibility |
| --- | --- |
| `CLAUDE.md` | hard gates, controller identity, repository boundaries, confirmation gates, testing boundaries, acceptance floor |
| skills | operation steps, commands, field templates, examples, troubleshooting |
| MCP tools | stable outer capability interface for workspace setup, status, state roots, packages, delivery envelope preparation/recording, review packs, controller decisions, Design/Test intake, next-work scans, archive actions, and verification |
| scripts | local implementation backend for file/state operations, result import/reduction, controller-return construction, archive internals, keep-live state, and backend checks |
| host transport | `scripts/lib/wakeflow-claude-host.mjs`, the tmux helper the agent runs via Bash for preflight, window launch/retitle, prompt send/readback, lock release, wait-results, and attach |
| templates | reusable starter surfaces for installed workspaces |
| `.wakeflow-active/` | ignored active runtime state |
| `.wakeflow-local/` | ignored local config plus delivery runtime; real thread ids (Claude Code session ids) live in `wakeflow-delivery/hosts/claude-code/thread-registry/`, window-host bindings in `hosts/claude-code/window-host/`, shared locks in `wakeflow-delivery/locks/` |
| `../wakeflow-ledger/` | project-specific long-term records |

## MCP Boundary

MCP tools organize only the outer agent workflow. They do not directly
manipulate real thread ids, fake host sends, expose every runtime script, or
decide acceptance. Target closeout stays split into narrow actions: record the
target result envelope, review readiness, prepare a controller-return envelope
when policy allows, send with the Claude Code host transport (the agent runs
`wakeflow-claude-host.mjs send` against the controller's tmux-resident
window), and record delivery evidence. The helper is a Bash-run script, not an
MCP tool. Internal runtime scripts remain available to Wakeflow skills and
tests without becoming public MCP tools.

In installed plugin workspaces, total-control agents must treat those scripts as
backend implementation details. They use Wakeflow MCP tools for setup, status,
state roots, delivery, archive, next-work scans, and verification. If the MCP
surface is unavailable, they stop and report the plugin-surface blocker instead
of constructing cache paths or guessing script parameters.

## Installed Workspace Shape

```text
ParentWorkspace/
  CLAUDE.md
  Wakeflow/
  ProductRepo/
  DesignRepo/
  TestRepo/
  wakeflow-ledger/
```

Product repositories remain siblings. Active state and local runtime files are
ignored. Long-term project records live outside the reusable Wakeflow repo.
Every Wakeflow window (controller included) runs as a tmux-resident `claude`
session inside the tmux server session named by `wakeflow.config.json`
`"hosts": { "claude-code": { "tmuxSession": "wakeflow" } }`.

## Dual-Host Storage

One workspace may run both the Codex and the Claude Code Wakeflow plugins.
Business state is shared across hosts: `.wakeflow-active/`,
`wakeflow-ledger/`, and
`.wakeflow-local/wakeflow-delivery/{dispatch-packets,dispatch-groups,delivery-envelopes,delivery-runs,target-results}/`.
Host transport runtime is host-scoped:
`.wakeflow-local/wakeflow-delivery/hosts/claude-code/` (this plugin's thread
registry and window-host bindings) and `hosts/codex/` (the Codex plugin's
twin). `locks/` is shared so each window has at most one in-flight delivery
across both hosts. `AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) coexist,
each owned by its plugin, and each demand has exactly ONE controller across
hosts.
