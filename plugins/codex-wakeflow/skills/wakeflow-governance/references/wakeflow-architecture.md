# Wakeflow Architecture Reference

## Product Shape

Wakeflow is a host-neutral workflow authority plus Codex-specific host seams.
It maintains configuration, current business state, local identity/
coordination/transport, portable archives, and the Agent procedures that use
them. It is not a product repository and never replaces controller judgment.

## Layers And Owners

| Layer | Responsibility |
| --- | --- |
| `AGENTS.md` | hard role, repository, confirmation, validation, and acceptance boundaries |
| Skills | agent procedure and routing; no hidden state authority |
| exact 31-tool MCP surface | closed public v3 operations; one typed domain owner per mutation |
| `wakeflow.config.json` | single strict tracked desired model with typed IDs |
| `.wakeflow-active/` | current demand/TODO/artifact/event/result/evidence authority plus projections |
| `.wakeflow-local/runtime/shared/` | cross-host coordination leases and per-demand transport |
| `.wakeflow-local/runtime/hosts/codex/` | private typed bindings, redacted projections, host evidence, and host operations |
| `.wakeflow-local/runtime/maintenance/` | unique recoverable workspace-mutation journal |
| `.wakeflow-local/audit/preserved/` | isolated manifest-bound retained bytes, never normal authority |
| configured ledger/support surfaces | requirement designs and portable whole-demand BusinessArchives |
| two localized demand-progress assets | generated from `core/template-sources/`; no v2 starter-document bundle |

Shared behavior is implemented in canonical `core/` source and synchronized to
both artifacts. Codex-specific thread creation/send/readback/archival belongs at
the host seam; shared code consumes a host profile and never branches on a
guessed host name.

## Public Boundary

Every routed public call has one closed envelope: workspace `root`, optional
typed `demandId`, exact `operation`, and an owner-specific closed `request`.
Workspace/state/config/ledger paths are derived. Public results redact raw
handles, absolute private roots, locators, and internal mutation tokens.

Maintenance exposes only `fresh-initialize`, `reconfigure`, and `reconcile`
through `wakeflow_maintain_workspace`, each with preview/apply/recover.
Explicit migration is intentionally absent from MCP/CLI/Skills and exists only
behind the fixed unregistered `bin/wakeflow-bootstrap` stdin contract.

MCP plans and records authority; it does not impersonate a host effect. Target
delivery remains preview → apply → claim → host effect → outcome. TargetResult,
group review, candidate, decision, and Controller return remain distinct.
Controller-return never takes a target lease. BusinessArchive and transport
retention are separate owners.

## Identity And Dual Host

The stable typed `windowId` and current host-local binding are routing
authority. A semantic title, repository directory, prompt assertion, or
window-runtime projection is not identity. One workspace may have both Codex
and Claude bindings, while business state and transport remain shared.

Each host owns only its subtree under `.wakeflow-local/runtime/hosts/<host>/`.
The shared typed lease prevents concurrent target effects across hosts. Host
selection follows the current binding plus strict transport lineage; there is
no mutable `controllerHost`, adopt-host state machine, or global workspace
registry.

## Installed Workspace Shape

```text
Workspace/
  wakeflow.config.json
  AGENTS.md
  .wakeflow-active/
  .wakeflow-local/
  <configured product repositories and support surfaces>
  <configured ledger root>
```

Fresh initialization uses a complete caller-confirmed selection and may create
all managed surfaces at once. File count is not a design constraint; every
file must have one owner, authority class, lifecycle, and recovery boundary.

The baseline fleet is mainline. A Pod exists only with explicit user authority
and owns independent Controller, Design, Test, and product bindings. Pod
logical state, host evidence, worktree lifecycle, and acceptance remain
separate responsibilities.
