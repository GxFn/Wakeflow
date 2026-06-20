# Wakeflow: Dual-Edition Architecture and State Flow

> Generated 2026-06-19 from source at commit HEAD; code is the source of truth.

This document synthesizes seven parallel subsystem reads of the Wakeflow source.
Where a reader flagged an uncertainty, it is surfaced in an **Open questions /
verify** note rather than guessed. File citations use `path:line` form.

---

## 1. Overview

Wakeflow is a reusable **controller-first, multi-window agent orchestration**
capability. It is not a product repository and not the parent workspace — it is
a controller runtime that a host agent (Claude Code or Codex) installs into a
workspace to plan, dispatch, accept, and archive cross-repository work across
multiple agent windows.

The whole system runs on one model:

> **Prompts wake, state instructs.**

A *delivery prompt* is only a compact wakeup envelope that navigates a target
window to its work; the authoritative *what/why/completion-definition* lives in
durable on-disk state (the per-demand state root, dispatch packets, delivery
envelopes, and result envelopes). The controller never carries the full task in
the prompt — it carries ids and a wakeup, and the target reads state.

Three structural pillars hold this up:

1. **One host-neutral core** (`core/`) with a hand-rolled MCP server exposing 23
   `wakeflow_*` tools, each of which spawns an allowlisted Node script.
2. **A demand state machine** (`core/scripts/wakeflow-state.mjs`) of seven
   reducers driving a single per-demand state root, plus a separate transport
   lifecycle (`core/scripts/wakeflow-delivery.mjs`) for envelopes, runs, and
   results.
3. **A host-profile seam** that lets the identical core run on two different
   transports — Claude Code tmux-resident sessions and Codex host threads —
   without ever branching on host id.

---

## 2. Dual-Edition Architecture

### 2.1 The shape

Wakeflow ships **two self-contained marketplace plugin artifacts built from one
shared source**:

- `core/` holds **64 host-neutral runtime files** (the MCP server, runtime libs,
  21 `scripts/lib` modules, 25 top-level scripts, JSON schemas, the bin shim,
  assets, and config examples). The full breakdown: `scripts/`=46 (25 top-level
  + 21 `scripts/lib`), `schemas/`=7, `lib/`=4, `mcp/`=1, `bin/`=1, `assets/`=2,
  3 root files (`LICENSE` + 2 `workspace.config.*.json`).
- `plugins/codex-wakeflow/` and `plugins/claude-code-wakeflow/` are each a
  **complete install surface** that commits **plain byte-identical copies of 63
  of those core files**. The 64th — `scripts/lib/wakeflow-host-profile.mjs` — is
  excluded from sync because it is host-local.

The seam between hosts is `wakeflow-host-profile.mjs`. Every core script
statically imports `./lib/wakeflow-host-profile.mjs` (a relative sibling import),
so after sync each install surface resolves *its own* host-specific profile
sitting next to the identical core copies.

The enforced contract: **core files may interpolate `hostProfile` values but must
never branch on `hostId`.** This is verified empirically — `grep -rn 'hostId ===' core/`
returns **zero hits**. Core only interpolates, e.g. `core/lib/wakeflow-mcp-tools.mjs:29`
uses `hostProfile.memoryFileLabel`.

### 2.2 Architecture diagram

```mermaid
flowchart TB
  subgraph SRC["SOURCE OF TRUTH — core/ (64 files)"]
    CORE["mcp/server.cjs · lib/*.mjs · bin/wakeflow-mcp.mjs<br/>scripts/*.mjs (25 top-level) · scripts/lib/*.mjs (21)<br/>schemas/*.json · workspace.config.*.json"]
    DEVSTUB["scripts/lib/wakeflow-host-profile.mjs<br/><i>DEV STUB — NOT synced</i>"]
  end

  SYNC["tools/sync-core.mjs<br/>TARGETS=[codex, claude-code]<br/>HOST_LOCAL_CORE_FILES={host-profile}<br/>sameContent = Buffer.equals<br/>--check: report drift, exit 1<br/>default: copyFileSync<br/>+ assert 14 HOST_CONTRACT_FILES(target) exist<br/>(manifest + memoryFile names vary per edition)"]

  CORE -->|"63 byte-identical"| SYNC

  subgraph CODEX["plugins/codex-wakeflow/ (committed copies)"]
    CXSHARED["63 byte-identical core copies"]
    CXHOST["HOST-SPECIFIC (never synced):<br/>host-profile.mjs (hostId=codex, AGENTS.md)<br/>host-send-adapter.mjs → send_message_to_thread<br/>host-artifact-checks.mjs (.codex-plugin)<br/><b>NO transport helper script</b>"]
  end

  subgraph CLAUDE["plugins/claude-code-wakeflow/ (committed copies)"]
    CLSHARED["63 byte-identical core copies"]
    CLHOST["HOST-SPECIFIC (never synced):<br/>host-profile.mjs (hostId=claude-code, CLAUDE.md)<br/>host-send-adapter.mjs → tmux paste via helper<br/>host-artifact-checks.mjs (.claude-plugin)<br/>wakeflow-claude-host.mjs (1557L tmux transport)"]
    CLCMD["commands/ (7 *.md slash commands) — Claude-only"]
  end

  SYNC --> CXSHARED
  SYNC --> CLSHARED

  MKT[".claude-plugin/marketplace.json<br/>source: ./plugins/claude-code-wakeflow<br/>(publishes CLAUDE edition only)"]
  MKT -.-> CLAUDE

  CORESCRIPT["any core script"] -->|"import './lib/wakeflow-host-profile.mjs'"| RESOLVE["resolves to the edition-local profile<br/>sitting beside it post-sync"]
```

### 2.3 File-ownership table (core-synced vs host-specific)

| Class | Files | Sync behavior |
|---|---|---|
| **Synced — byte-identical (63)** | all of `core/` except `scripts/lib/wakeflow-host-profile.mjs` | `Buffer.equals` compare; `--check` reports drift (exit 1), default mode `copyFileSync` |
| **Host-local — not synced (3 lib files)** | `scripts/lib/wakeflow-host-profile.mjs`, `wakeflow-host-artifact-checks.mjs`, `wakeflow-host-send-adapter.mjs` | only the profile is an explicit `HOST_LOCAL_CORE_FILES` exclusion (`:59-61`) — it **does** exist in `core/scripts/lib/` and is skipped (`:72`). The send-adapter and artifact-checks are **not excluded** because they **do not exist in `core/` at all** (confirmed: `core/scripts/lib/` holds only `wakeflow-host-profile.mjs` among the host-* files), so they are never sync candidates. All three are listed in `HOST_CONTRACT_FILES` and only **existence-checked**. The send-adapter and artifact-checks differ **byte-for-byte** between editions |
| **Host-contract — existence-checked only (14 per target)** | manifest, `.mcp.json`, memory file (`CLAUDE.md`/`AGENTS.md`), README ×2, `package.json`, `scripts/README.md`, the 3 host-lib files, 3 `SKILL.md`, template bundle | `--check` asserts each EXISTS but never byte-compares. `HOST_CONTRACT_FILES` is a **function of `target`** (`:42-57`): `target.manifest` and `target.memoryFile` resolve to the edition's own filenames (`.codex-plugin/plugin.json`+`AGENTS.md` vs `.claude-plugin/plugin.json`+`CLAUDE.md`), so the existence checks use the right per-edition names |
| **Claude-only extra** | `scripts/lib/wakeflow-claude-host.mjs` (1557-line tmux transport helper), `commands/` (7 slash-command `.md` files) | shipped only in the Claude edition; Codex has no equivalent |

Key citations:

- `tools/sync-core.mjs:29-40` (`TARGETS`), `:42-57` (`HOST_CONTRACT_FILES`),
  `:59-61` (`HOST_LOCAL_CORE_FILES`), `:63-77` (`listCoreFiles`), `:79-82`
  (`sameContent` = `readFileSync(a).equals(readFileSync(b))`), `:102-121`
  (sync/check loop), `:115-120` (existence assertion).
- `package.json:6-9` (npm workspaces), `:11-21` (`sync:core`/`check:core`/`test`).
- `.claude-plugin/marketplace.json:11-16` (single `wakeflow` entry, source
  `./plugins/claude-code-wakeflow`).

### 2.4 The byte-identity sync rule

`sync-core.mjs` enforces identity with a raw **`Buffer.equals`** comparison
(`:79-82`), **not** a hash digest — any single-byte difference counts as drift.

- `--check` (CI gate, wired into `npm test` first, `package.json:21`): drift
  pushes `${target.dir}/${rel} drifts from core/${rel}`, missing dir pushes an
  issue, then `process.exitCode = 1`.
- default `--write`: `mkdirSync(recursive)` + `copyFileSync`, increments
  `copied`.
- Empirically `node tools/sync-core.mjs --check` returns `{ok:true, coreFiles:63, issues:[]}`.

The `TARGETS` are hardcoded with per-edition manifest + memory file names so the
existence check uses the right filenames: `{dir:'plugins/codex-wakeflow', manifest:'.codex-plugin/plugin.json', memoryFile:'AGENTS.md'}` and
`{dir:'plugins/claude-code-wakeflow', manifest:'.claude-plugin/plugin.json', memoryFile:'CLAUDE.md'}`.

### 2.5 The host-profile contract (four abstracted seams)

The profile exposes four seams that core interpolates but never branches on:

1. **Identity / vocabulary** — `hostId`, `hostName`, `decisionOwner`,
   `memoryFile`/`memoryFileLabel`, `pluginManifestDir/Path`, `kinds`
   (host-branded on-disk record kinds), `closedLoopContractName`, `handleId`
   placeholders + real-id requirement.
2. **Transport / send** — `hostTools {createWindow, retitleWindow, sendToWindow}`
   plus the separate `wakeflow-host-send-adapter.mjs`.
3. **Window launch** — `launch.{planFlags, workflowSteps, titleReset, entryExtras, effortByRole/thinkingByRole}`.
4. **Registry / keep-live / residue** — `runtime.{hostDirName, legacyRegistryFallback}`,
   `keepLiveEnv` var names, `workspaceResidueChecks`.

The transport seam **diverges structurally**:

- **Claude**: `hostTools` are subcommands of the 1557-line
  `wakeflow-claude-host.mjs` (`launch-window`/`retitle`/`send`); its dispatch
  table is at `wakeflow-claude-host.mjs:1520-1541`. The send-adapter pastes the
  envelope into tmux (`claudeTmuxResidentAdapter`, `send-adapter:24-34`) with a
  `claude -p --resume` headless-recovery last resort (`claudeHeadlessRecoveryAdapter`,
  `:36-46`; the `adapterForWindowMode` dispatcher that selects between them is the
  separate `:48-51`).
- **Codex**: `hostTools` are native agent tools `create_thread`/
  `set_thread_title`/`send_message_to_thread`; the adapter
  (`codexAppThreadHostAdapter`, `send-adapter:1-15`) delegates to
  `send_message_to_thread` — **no helper script, no tmux**.

Additional edition facts:

- The Claude edition ships `commands/` (7 slash commands) and `artifact-checks`
  requires both `skills/` and `commands/` (`wakeflow-host-artifact-checks.mjs:29-34`);
  Codex has no `commands/` and instead carries a `.codex-plugin` `interface{}`
  block.
- All edition manifests are version-locked at **0.5.8** in **five places**: both
  plugin manifests (`.codex-plugin/plugin.json:3`, `.claude-plugin/plugin.json:3`),
  both plugin `package.json`s, and the marketplace **plugin entry**
  (`.claude-plugin/marketplace.json` `plugins[0].version`). The marketplace file
  also carries a **second, distinct** version field — `metadata.version` is
  `1.0.0` (the catalog metadata, not the plugin version) — so the same file has
  two different version fields and only the `plugins[0]` one tracks the 0.5.8
  lock. Root `package.json` stays `0.0.0` / `private:true` (private dev
  workspace). `sync-core` does **not** enforce version equality — manifests are
  existence-only.
- The marketplace publishes **only** the Claude edition; the Codex edition's
  `artifact.marketplacePath` points at a separate `.agents/plugins/marketplace.json`.
- The `core/` host-profile copy is a **Codex dev stub** (`hostId codex` but
  `workspaceResidueChecks: []`) excluded from sync, present only so core scripts'
  relative imports resolve when running from `core/` during repo development.

**Note:** This is the single architecture reference for Wakeflow; per the header,
where any prose here and the code disagree, the code is authoritative.

> **Open questions / verify:** The no-`hostId`-branch claim rests on a grep for
> `hostId ===` returning zero hits in `core/`; this would miss exotic dynamic
> dispatch (e.g. `hostProfile.hostId` used as an object key). The five 0.5.8
> version fields currently match but `check:core` does not catch version drift. The
> Codex `.agents/plugins/marketplace.json` distribution path lives outside this
> repo's tracked tree and was not confirmed.

---

## 3. MCP Tool Surface

### 3.1 How the server boots and dispatches

The MCP surface is a **hand-written stdio JSON-RPC 2.0 server with no SDK
dependency**:

- **Registration / boot entrypoint.** Both editions' `.mcp.json` register the
  server **directly** as `node <pluginRoot>/mcp/server.cjs` — the Claude edition
  uses `${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs` with `env
  WAKEFLOW_DEFAULT_ROOT=${CLAUDE_PROJECT_DIR}`; the Codex edition uses
  `./mcp/server.cjs` with `cwd:'.'`. Each `plugin.json` points
  `mcpServers` at `./.mcp.json` (`claude .claude-plugin/plugin.json:20`,
  `codex .codex-plugin/plugin.json:22`). The Claude `WAKEFLOW_DEFAULT_ROOT`
  injection is what grounds the `defaultWorkspaceRoot` fallback chain in §3.3.
- `core/bin/wakeflow-mcp.mjs` (`:1-3`) is a 3-line shim that imports
  `../mcp/server.cjs`. It is **NOT** the executable named by the plugin's MCP
  registration — the `.mcp.json` files target `mcp/server.cjs` directly, so the
  bin shim is an alternate/unused entrypoint on the MCP path (useful for a manual
  `node core/bin/wakeflow-mcp.mjs` launch during repo dev, but the host never
  invokes it).
- `core/mcp/server.cjs` implements the full framed transport (newline-delimited
  JSON **and** Content-Length framing, plus JSON-RPC batch arrays), protocol
  negotiation (latest `2025-11-25`, default `2025-03-26`, 5 supported versions),
  and the `initialize`/`notifications/initialized`/`ping`/`tools/list`/`tools/call`
  methods.
- On boot, `main()` dynamically imports `pluginRoot/lib/wakeflow-mcp-tools.mjs`
  to get `{tools, handlers}`, then starts `LineJsonRpcTransport` over
  stdin/stdout.
- `tools/call` → `callTool(params, handlers)` → `handlers[name](args)`, which
  builds a `[subcommand, ...flags]` list and calls `runWakeflowRuntime`. The
  return is `JSON.stringify`'d into a single text content block.

`runWakeflowRuntime` (`core/lib/wakeflow-runtime.mjs:56-104`) resolves the logical
`script` name against an **allow-list Map** of 25 entries (`:18-44`), spawns
`node <pluginRoot>/scripts/<file>.mjs <args>` through the audited `spawnProcess`
boundary (`core/lib/wakeflow-process.mjs`), with env `WAKEFLOW_CONTROL_RUNTIME=1`,
no shell, `stdio ['ignore','pipe','pipe']`, and a SIGTERM timeout (default
120000ms). It parses the **last JSON object** from stdout (`parseLastJson`,
tolerating leading log lines), then wraps the result with `wakeflowTrace`,
`wakeflowRuntimeStatus`, optional `wakeflowError` (classified code; only
`runtime-timeout` is retryable), and — for `wakeflow-cli status` only —
`wakeflowHealth`.

The process boundary is hard-locked: `prepareWakeflowCommand`
(`wakeflow-process.mjs:58-78`) rejects `shell`, requires string-array args, and
permits **only** `node` (with blocked `eval`/`require`/`loader` flags), `git`
(allow-listed subcommands), exactly `ps -axo pid,command`, and darwin
`caffeinate`. Anything else throws `Unsupported Wakeflow process command`.

`prioritizeHostVisibleTools` (`wakeflow-mcp-tools.mjs:538-571`) hoists 12 named
tools to the front of `tools/list` because some Codex hosts only surface an early
prefix of MCP tools — ordering only, not availability.

### 3.2 Boot / dispatch diagram

```mermaid
flowchart TB
  STDIN["stdin (JSON-RPC: NDJSON or Content-Length framed)"]
  REG[".mcp.json registers: node &lt;pluginRoot&gt;/mcp/server.cjs<br/>(claude: env WAKEFLOW_DEFAULT_ROOT=CLAUDE_PROJECT_DIR)"]
  SHIM["core/bin/wakeflow-mcp.mjs (3-line shim)<br/><i>alternate/unused MCP entrypoint</i>"]
  SHIM -.->|import (dev only)| SRV["core/mcp/server.cjs"]
  STDIN --> REG
  REG -->|host launches| SRV
  SRV -->|"main(): dynamic import"| TOOLS["core/lib/wakeflow-mcp-tools.mjs {tools, handlers}"]
  SRV --> DRAIN["LineJsonRpcTransport.drain → handleMessage(method)"]
  DRAIN --> INIT["initialize / ping / notifications-initialized"]
  DRAIN --> LIST["tools/list → {tools} (12 priority tools hoisted)"]
  DRAIN --> CALL["tools/call → callTool(name, arguments)"]
  CALL --> H["handlers[name](args)<br/>build [subcommand, ...CLI flags]<br/>via optionalValue/repeatValues/rootArgs<br/>(+ default --compact on 4 delivery/result tools)"]
  H --> RT["runWakeflowRuntime({script, args, cwd})"]
  RT --> ALLOW["allowedScripts.get(script) → scripts/&lt;file&gt;.mjs (else throw)"]
  ALLOW --> SPAWN["spawnNode → spawnProcess (no shell)<br/>node scripts/file.mjs args<br/>env WAKEFLOW_CONTROL_RUNTIME=1, SIGTERM timeout"]
  SPAWN --> PARSE["child stdout → parseLastJson(stdout)"]
  PARSE --> WRAP["wrap: wakeflowTrace + RuntimeStatus + [Error] + [Health(status only)]"]
  WRAP --> OUT["toolContent: JSON.stringify(result) as single text block → stdout"]
```

### 3.3 Tool → script → command map

There are **23 tool definitions and 23 matching handler keys**. `wakeflow_verify`
is itself one of the 23 `toolDefinitions` entries (`wakeflow-mcp-tools.mjs:525`,
inside the array opened at `:26` that feeds `tools =
prioritizeHostVisibleTools(toolDefinitions)` at `:557`) — it is **not** added
separately, so the count is a flat 23, not "22 + verify". The handler keys span
`wakeflow-mcp-tools.mjs:573-937`. All handlers always append `--json`. Only the
four delivery/result tools accept `verbose` and default to `--compact` (see
§3.4).

| MCP tool | Script (logical) | Subcommand + notable flags |
|---|---|---|
| `wakeflow_initialize_workspace` | `wakeflow-setup` | `initialize` — `--root`, optional `--parent`/`--workspace-name`/`--controller-window`/`--design-window`/`--test-window`/`--language`, booleans `--reset-initialization`/`--use-discovered`/`--internal-design`/`--internal-test`/`--include-real-project`, `--repo win=path` (+`--role`), repeated `--exclude-window`, `apply`→`--write` |
| `wakeflow_replace_windows` | `wakeflow-setup` | `window`→`replace-window` (`--window`); else `replace-windows` (repeated `--window` from `windows`); readOnly plan |
| `wakeflow_adopt_demand_host` | `wakeflow-state` | `adopt-demand-host` — `--state-root`, optional `--reason`, `apply`→`--write` |
| `wakeflow_render_progress` | `wakeflow-render-progress` | (no subcommand) `--state-root`, `--root`, `apply`→`--write` |
| `wakeflow_release_window_lock` | `wakeflow-delivery` | `release-window-lock` (`--window`, `apply`→`--write`) |
| `wakeflow_status` | `wakeflow-cli` | `status --root <root> --json` (fans out, §3.5) |
| `wakeflow_init_demand` | `wakeflow-state` | `init` — `--demand-key`,`--title`, optional `--goal`/`--completion-definition`/`--stage-plan`/`--state-root`, `--write`, optional `--language` |
| `wakeflow_add_task` | `wakeflow-state` | `add-task-package` — `--state-root`, `--task-package-id`, `--summary`, `--target-window`, `--target-task-id`, optional `--target-summary`/`--source-ref`, `adoptHost`→`--adopt-host`, `--write` |
| `wakeflow_prepare_delivery` | `wakeflow-delivery` | `direction=controller-return` → `build-controller-return`; `direction=target` (default) → `prepare-dispatch-from-state`; `--compact` unless `verbose` |
| `wakeflow_record_delivery` | `wakeflow-delivery` | `record-delivery-run` — `--delivery-file`,`--status`, optional `--evidence`/`--error`/`--host-method`/`--host-mode`, `--readback-ok <bool>`, optional `--delivery-run-id`, `--compact` unless `verbose` |
| `wakeflow_record_target_result` | `wakeflow-state` | `import-target-result` — `--state-root`,`--target-task-id`,`--target-window`,`--status`, optional `--result-id`/`--summary`, repeated `--evidence-ref`/`--verification`/`--risk`, `--compact` unless `verbose` |
| `wakeflow_review_pack` | `wakeflow-delivery` | `review-pack` — optional `--state-root`/`--group`/`--task-id`; readOnly |
| `wakeflow_view` | `wakeflow-state` / `wakeflow-delivery` | by `scope`: `task-ledger`→`wakeflow-delivery task-ledger` (`--task-id`/`--target-window`); `window`→`wakeflow-state window-view` (`--window`); `focus`→`wakeflow-state focus-doc` (`--window`/`--phase`, `apply`→`--write`); `trace`→`wakeflow-delivery trace-spine` (`--group`/`--target-window`/`--task-id`/`--result-file`/`--result-id`/`--delivery-file`/`--delivery-id`); readOnly except focus+apply |
| `wakeflow_reduce_results` | `wakeflow-state` | `reduce-results` — `--state-root`, `apply`→`--write`, `adoptHost`→`--adopt-host` |
| `wakeflow_decide_review` | `wakeflow-state` | `decide-review` — `--state-root`,`--candidate-id`,`--decision`,`--reason`, repeated `--evidence-ref`, `acceptBlocked`→`--accept-blocked`, `apply`→`--write`, `adoptHost`→`--adopt-host` |
| `wakeflow_complete_demand` | `wakeflow-state` | `complete-demand` — `--state-root`,`--reason`, repeated `--evidence-ref`, `apply`→`--write`, `adoptHost`→`--adopt-host` |
| `wakeflow_intake_design_handoff` | `wakeflow-intake` | `design-handoff` — `--state-root`,`--design-key`, optional `--board`, `apply`→`--write` |
| `wakeflow_intake_test_card` | `wakeflow-intake` | `test-card` — `--state-root`,`--test-id`,`--target-window`,`--question`,`--object-boundary`, repeated self-check/scenario/success/failure/cannot-conclude/stop-condition, optional `--source-ref`, repeated evidence/allowed/forbidden operation, `apply`→`--write` |
| `wakeflow_next_work` | `wakeflow-next-work` | (no subcommand) `--root`, optional `--id`/`--source`/`--limit`, `afterCompletion`→`--after-completion`, `apply`→`--write` |
| `wakeflow_archive` | `wakeflow-state` / `wakeflow-archive-todo` / `wakeflow-archive-docs` | by `target`: `demand`→`wakeflow-state archive-demand` (`--state-root`/`--reason`, `redact`→`--redact`, repeated `--evidence-ref`, `apply`→`--write`); `todo`→`wakeflow-archive-todo` (optional `--month`/`--date`/`--keep-completed`/`--keep-sync`, `apply`→`--apply`); `docs`→`wakeflow-archive-docs` (optional `--topic`/`--month`, repeated `--file`, `keepIndexRows`/`pruneIndexOnly`, `apply`→`--apply`); todo/docs async — chain `wakeflow-archive-summaries` when `refreshSummaries && ok` |
| `wakeflow_verify` | `wakeflow-cli` | `verify --root <root> [--script-tests] --json`; timeout 180000ms with script-tests else 120000ms |

Arg→flag translation is mechanical via four helpers (`wakeflow-mcp-tools.mjs:960-1004`):
`optionalValue(flag,value)` (empty for `undefined`/`null`/`''`), `repeatValues`
(repeated flags), bare booleans inline, and `rootArgs` = `optionalValue('--root', args.root ?? defaultWorkspaceRoot())`. `defaultWorkspaceRoot` falls back to the
first existing absolute path among `WAKEFLOW_DEFAULT_ROOT` / `CLAUDE_PROJECT_DIR`.

### 3.4 Compact vs verbose

Default-compact applies **only** to `wakeflow_prepare_delivery` (both directions),
`wakeflow_record_delivery`, and `wakeflow_record_target_result`; all append
`--compact` when `verbose` is falsy. Compact replaces the full structured payload
(envelope/packet/run/result echoes) with `{compact:true, ...ids, prompt}` because
the full artifact is always written to disk regardless — described in-code as
"the controller's single biggest context burner (60-70KB per dispatch)."

Per command, compact keeps (and the full file always lands on disk):

- `build-delivery` → `{ok,command,wrote,compact,deliveryId,targetWindow,taskId,dispatchGroup,returnRoute,prompt,deliveryFile,threadReady,windowLockWarning}`.
- `prepare-dispatch-from-state` → `{compact,deliveryId,dispatchGroup,prompt}` + `packetFile`/`deliveryFile` paths (drops windowConfig/packet/envelope; omits forbiddenConclusions).
- `build-controller-return` → `{compact,deliveryId,controllerWindow,dispatchGroup,prompt}`.
- `record-delivery-run` → `{compact,deliveryRunId,deliveryId,targetWindow}`.
- `import-target-result` → `{compact,resultId,status,dispatchGroup,targetWindow,taskId}`.

### 3.5 Special dispatch cases

- `wakeflow_status` / `wakeflow_verify` route through `core/scripts/wakeflow-cli.mjs`.
  `status` fans out to **two** scripts — `wakeflow-repo-status.mjs` (`repoStatus`)
  and `wakeflow-delivery.mjs status` (`closedLoopStatus`) — then `runStatusJson`
  emits `{ok, command:'status', checks:[...]}`; `buildWakeflowHealth` adds a
  summary only for this case.
- Archive tools are async and, when `refreshSummaries && result.ok`, chain a
  second spawn of `wakeflow-archive-summaries` and return `{ok, archive, summaries}`.
- Dispatch gating: `prepare-dispatch-from-state` fails closed when
  `state.controllerHost` is set and differs from `hostProfile.runtime.hostDirName`,
  instructing the caller to dispatch from the owning controller or run
  `adopt-demand-host` (`core/scripts/lib/wakeflow-dispatch-commands.mjs:359-360`).

> **Open questions / verify:** The full non-compact payload shapes of
> `wakeflow-setup`/`wakeflow-intake`/`wakeflow-next-work`/archive scripts were not
> read line-by-line. The `core/` host-profile is a Codex dev stub, so tool
> descriptions in this source say `Codex`/`AGENTS`/`create_thread`; a real Claude
> install surfaces the Claude equivalents. `wakeflow-cli.mjs` exposes more
> subcommands (sync, design, intake, install, loop, sequence, runtime, scripts)
> that are CLI-reachable but **not** wired to any MCP tool. The standalone
> `core/scripts/wakeflow-runtime.mjs` CLI is a separate dev entrypoint NOT on the
> MCP path. (Host registration/launch is now traced — see §3.1: both editions'
> `.mcp.json` register `node <pluginRoot>/mcp/server.cjs` directly, not the bin
> shim.)

---

## 4. End-to-End Lifecycle

The controller loop spans two CLI scripts plus the thin MCP proxy. The
state-machine lifecycle lives in `core/scripts/wakeflow-state.mjs` (writes the
durable state root); the transport lifecycle lives in
`core/scripts/wakeflow-delivery.mjs` and its libs (writes ignored local runtime
under `.wakeflow-local/wakeflow-delivery`).

**The single point that advances durable state during dispatch is
`record-delivery-run`** → `markStateRootDeliverySent`, which flips the target task
to `status=sent` and the demand to `state=dispatched`
(`wakeflow-result-recording-commands.mjs:86-232`). `prepare-dispatch-from-state`
writes **only** local runtime (packet/group/envelope/lock) and never touches
`wakeflow-state.json`.

> **Vocabulary note:** Two of the seven subsystem readers describe the demand
> states slightly differently. The reducer source writes seven demand states
> (`intake`, `planned`, `waiting-results`, `review-ready`, `needs-rework`,
> `blocked`, `completed`). One reader observed `markStateRootDeliverySent` also
> writes a transient `dispatched` state. This document treats `dispatched` as a
> real but transport-driven write that `reduce-results` then resolves into
> `waiting-results`/`review-ready`. See §5.1 for the reconciliation.

### 4.1 Lifecycle sequence diagram

```mermaid
sequenceDiagram
    participant U as User/Controller
    participant NW as next_work (scan)
    participant ST as wakeflow-state.mjs (durable state root)
    participant DL as wakeflow-delivery.mjs (local runtime)
    participant H as Host send (claude tmux / codex thread)
    participant TW as Target window

    U->>NW: next_work (eligibility scan, no write)
    NW-->>U: ranked candidates / autoClaimable
    U->>ST: init_demand (init) ⇒ state=intake, rev1, controllerHost=null
    U->>ST: add_task (add-task-package) ⇒ first claim stamps controllerHost; task=pending; intake→planned
    Note over U,DL: review_pack --state-root is read-only orientation
    U->>DL: prepare_delivery direction=target (prepare-dispatch-from-state)
    DL->>DL: eligibility gate + write packet/group/envelope + ACQUIRE window lock (TTL 7200s)
    DL-->>U: envelope.prompt (NO state change)
    U->>H: host send (paste prompt into tmux pane / send_message_to_thread)
    H-->>U: readback evidence (paneTail / thread reply)
    U->>DL: record_delivery status=sent (needs readback.ok + evidence)
    DL->>ST: markStateRootDeliverySent ⇒ task=sent, state=dispatched, refresh lock
    Note over TW: target executes its dispatch packet
    TW-->>U: TargetResultEnvelope (completed|blocked|needs-review)
    U->>ST: record_target_result (import-target-result) ⇒ write result, RELEASE lock, revision UNCHANGED
    alt returnRoute=controller
        U->>DL: review_pack --group (callbackPlan: ready-to-build)
        U->>DL: prepare_delivery direction=controller-return (readiness + duplicate guards)
        U->>H: host send controller-return prompt
        U->>DL: record_delivery (ControllerReturnEnvelope run ⇒ sent)
    end
    U->>ST: reduce_results (reduce-results)
    alt all open results present
        ST-->>U: transition-candidate, state=review-ready, allow decide-review
        U->>ST: decide_review (accept|rework|blocked)
        alt accept
            ST-->>U: tasks=accepted, state=planned, allow complete-demand
        else rework
            ST-->>U: tasks=needs-rework ⇒ loop back to prepare_delivery
        else blocked
            ST-->>U: state=blocked + review-blocker (WEDGE; fresh result re-opens)
        end
    else missing results
        ST-->>U: state=waiting-results (no candidate)
    end
    U->>ST: complete_demand (all accepted + no blockers + ≥1 evidence-ref)
    ST-->>U: state=completed, review=demand-completed
```

### 4.2 Guards at each step

| Step | Guard(s) |
|---|---|
| `init` | refuses to write into the plugin dir (`assertWorkspaceRootResolved`); state root must be inside workspace/ledger; `controllerHost=null` |
| `add-task-package` | refuses while `completed`/`archived`/`paused`, while `review-ready`/`accepting`/`waiting-results` ("reduce or decide first"), while `blocked` or any blockers; **first driving command claims `controllerHost`** |
| `prepare-dispatch-from-state` | demand-host ownership gate; eligibility: demand not completed/archived/paused/blocked/review-ready/accepting, target task in `pending`/`needs-rework`/`missing-result`, package in `pending`/`needs-rework`; acquires the cross-host window lock (fail closed on a fresh other-host lock) |
| host send | (Claude) target window must be alive; per-window delivery lock; (Codex) controller calls the native host tool directly |
| `record-delivery-run status=sent` | requires `--readback-ok true` **and** non-empty `--evidence`; `markStateRootDeliverySent` advances state; refreshes lock |
| `import-target-result` | refuses if target task is already `accepted`; default-id collision auto-disambiguates with timestamp (rework); does **not** mutate controller state (`stateRevisionUnchanged`); releases the lock matching the answered delivery |
| `reduce-results` | refuses while `completed`/`archived`; refuses with zero open tasks; creates a transition candidate only when nothing is missing |
| `decide-review accept` | candidate `fromRevision == revision`; `demandKey` match; requires `--accept-blocked` if the candidate has `blockedResultIds`; clears review-blockers |
| controller-return | four readiness block reasons + duplicate-return guard (see §5) |
| `complete-demand` | every package **and** target task `accepted`; zero blockers; ≥1 `--evidence-ref` |

### 4.3 The two key safety guards

**The demand never AUTO-becomes "blocked" — but a mixed ready+blocked candidate
DOES surface as "blocked".** This corrects an earlier-believed (backwards)
safety property. The review-pack, dispatch-group snapshot, and transition
candidate **all surface `blocked` whenever ANY result is blocked, regardless of
how many ready results coexist**: the default (group-ready / state-root) review
branch computes `blocked.length > 0 ? "blocked" : "needs-controller-review"`
with **no** ready-count guard (`wakeflow-review-commands.mjs:411-413` in
`computeStateRootReviewResults`, `:610-612` in the group-ready branch);
`buildGroupSnapshot.groupStatus` is likewise `blocked` when `blocked.length>0`
regardless of `ready.length` (`wakeflow-dispatch-group-review.mjs:103-104`); and
`reduce-results` sets `candidateState='blocked'` whenever
`blockedResultIds.length>0` (`wakeflow-state.mjs:1045`). The mix is **only**
re-resolved to `needs-controller-review` in the **per-target** return-policy
branch, which alone carries the `blocked.length>0 && ready.length===0` guard
(`wakeflow-review-commands.mjs:603-605`). The real safety property is different:
the demand never AUTO-transitions to `blocked` — `decide-review blocked` is an
**explicit controller decision**, and recovery depends on review-scope (§5.1).
Operationally the controller is advised (by the MEMORY rule, **not** enforced by
code) to never CHOOSE `blocked` on a mixed candidate, precisely because the
machinery does not prevent it.

**`record_target_result` allowed for already-sent tasks but blocked for
accepted/completed.** A `sent`/`needs-review`/`blocked` task can still receive a
new result (the rework cycle); only `accepted` refuses re-import
(`wakeflow-state.mjs:832-834`).

**`markStateRootDeliverySent` (the dispatch-time `record-delivery-run` advance)
is idempotent-on-replay but fails on a conflicting delivery.** If the target task
is already `sent` with the **same** `deliveryId`, the command early-returns
`{updated:false, reason:'target-task-already-sent', idempotentReplay:true}` (a
no-op replay); if it is already `sent` with a **different** `deliveryId` it
**fails closed** (`refusing conflicting delivery …`)
(`wakeflow-result-recording-commands.mjs:114-128`). It additionally re-checks
demand-host ownership (`:101-103`) before any write.

> **Open questions / verify:** Two `record-target-result` implementations exist —
> the delivery-script command and the state-script `import-target-result`. The
> MCP tool `wakeflow_record_target_result` maps to the **state-script**
> `import-target-result` (`wakeflow-mcp-tools.mjs:757-758`), so the delivery-script
> variant is not the MCP path; its live role is uncertain (CLI/legacy).
> `decide-review accept` routes to `planned` (not directly `completed`), so a
> second explicit `complete-demand` is always required.

---

## 5. State Machines

Wakeflow has **two distinct state vocabularies that do not share an enum**:

1. The **demand** state machine (`core/scripts/wakeflow-state.mjs`) of seven
   reducer commands driving the per-demand state root.
2. A **separate window/runtime status vocabulary**
   (`core/scripts/lib/wakeflow-status-machine.mjs`, 17 values) used only by
   next-work/archive/docs-verify projections — **not** by the demand reducers.

There is also a **third** namespace: the inline `state-root window.windowState`
strings constructed in `wakeflow-state.mjs` with no schema backing. Three
distinct status namespaces is a real complexity to flag.

### 5.1 Demand state (`wakeflow-state.json .state`)

The schema enum (`wakeflow-state.schema.json:30-48`) lists **14** values
(`idle`, `intake`, `designing`, `needs-confirmation`, `planned`, `dispatching`,
`waiting-results`, `review-ready`, `accepting`, `needs-rework`, `blocked`,
`paused`, `completed`, `archived`) — a **superset** of what reducers write. The
reducers only ever assign: `intake`, `planned`, `waiting-results`, `review-ready`,
`needs-rework`, `blocked`, `completed` (plus the transport-driven `dispatched`
write in `markStateRootDeliverySent`). Of the rest, `paused`/`archived`/
`accepting`/`waiting-results` appear as **read guards**, while `designing`/
`needs-confirmation`/`dispatching`/`idle` are pure schema vestige. **Code wins**;
docs claiming these are live demand states are stale.

```mermaid
stateDiagram-v2
  [*] --> intake : init
  intake --> planned : add-task-package
  needs_rework --> planned : add-task-package
  planned --> planned : add-task-package
  planned --> dispatched : record-delivery-run sent
  dispatched --> waiting_results : reduce-results [missing results]
  dispatched --> review_ready : reduce-results [all present → candidate]
  planned --> waiting_results : reduce-results [missing results]
  planned --> review_ready : reduce-results [all present → candidate]
  waiting_results --> waiting_results : reduce-results [still missing]
  waiting_results --> review_ready : reduce-results [all present]
  review_ready --> planned : decide-review accept [candidate fresh; --accept-blocked if blocked]
  review_ready --> needs_rework : decide-review rework
  review_ready --> blocked : decide-review blocked [appends review-blocker → WEDGE]
  blocked --> review_ready : import-target-result(fresh) + reduce-results
  blocked --> planned : decide-review accept|rework [unblock; clears review-blockers]
  planned --> completed : complete-demand [all accepted, no blockers, evidence-ref]
  completed --> [*]
  note right of blocked
    WEDGE: add-task-package and complete-demand
    both refuse while blocked/blockers exist.
    Recovery = fresh result → reduce → accept/rework.
  end note
```

| From | To | Trigger | Guard |
|---|---|---|---|
| (none) | intake | init | not in plugin dir; root inside workspace/ledger; `controllerHost=null` |
| intake | planned | add-task-package | not completed/archived/paused; not review-ready/accepting/waiting-results; not blocked/no blockers; first-drive claim |
| needs-rework | planned | add-task-package | same gates; `nextMainState` lifts intake\|needs-rework → planned |
| planned | dispatched | record-delivery-run sent | `markStateRootDeliverySent`; envelope matches an open target task |
| planned/dispatched | waiting-results | reduce-results | ≥1 open target task lacks a latest result |
| planned/dispatched | review-ready | reduce-results | every open target task has a latest result (creates candidate) |
| waiting-results | review-ready | reduce-results | all results now present |
| review-ready | planned | decide-review accept | candidate fresh; demandKey match; `--accept-blocked` if blocked; clears review-blockers |
| review-ready | needs-rework | decide-review rework | candidate not stale; clears review-blockers |
| review-ready | blocked | decide-review blocked | candidate not stale; appends review-blocker → **WEDGE** |
| blocked | review-ready | import-target-result + reduce-results | import allowed while blocked; review-scope keeps blocked-but-not-final task reviewable |
| blocked | planned/needs-rework | decide-review accept\|rework | this decision **is** the unblock; clears review-blockers |
| planned | completed | complete-demand | all packages + tasks accepted; zero blockers; ≥1 evidence-ref |
| any non-completed | (same, re-stamped) | adopt-demand-host / `--adopt-host` | transfers `controllerHost`; bumps revision; invalidates outstanding candidates |

**The blocked wedge (core safety gotcha).** `decide-review blocked` sets
`state.state='blocked'`, marks candidate tasks `blocked`, and appends a
review-blocker. This wedges the demand: `add-task-package` refuses while blocked
or with blockers; `complete-demand` refuses with blockers or non-accepted tasks.
Recovery is designed in `wakeflow-review-scope.mjs:1-8`: only
`accepted`/`reviewDecision=accept` counts as final, so a blocked-but-not-accepted
task stays in `controllerReviewScope.reviewableTargetTasks`. The controller
imports a **fresh** result (allowed while blocked), re-reduces (re-includes the
still-open task → new candidate), then `decide-review accept|rework` clears the
review-blocker. Without review-scope keeping blocked tasks reviewable, the demand
would wedge permanently.

### 5.2 Target task (`state.targetTasks[].status`)

```mermaid
stateDiagram-v2
  [*] --> pending : add-task-package(--target-window)
  pending --> sent : record-delivery-run (markStateRootDeliverySent)
  pending --> missing_result : reduce [no result]
  sent --> completed : reduce [result.completed]
  sent --> blocked : reduce [result.blocked]
  sent --> needs_review : reduce [result.needs-review]
  sent --> needs_rework : reduce [prior reviewDecision=rework]
  completed --> accepted : decide accept
  needs_review --> accepted : decide accept
  blocked --> accepted : decide accept [--accept-blocked]
  completed --> needs_rework : decide rework
  blocked --> needs_rework : decide rework
  needs_review --> needs_rework : decide rework
  needs_rework --> sent : prepare-dispatch + record-delivery-run
  accepted --> [*]
```

**decide-review applies `nextTaskStatus` to the WHOLE candidate scope at once.**
A single `decide-review` stamps the **same** `nextTaskStatus`
(`accept→accepted` / `rework→needs-rework` / `blocked→blocked`) on **every** task
in the candidate's `controllerReviewScope`, not per-prior-status
(`wakeflow-state.mjs:1209-1220`). So one `accept --accept-blocked` decision sweeps
a mixed-status set (e.g. a `blocked` task and a `completed` task) **all** to
`accepted`, and one `rework` decision moves a `blocked` task to `needs-rework`
(`blocked → needs-rework`). This is exactly how the blocked wedge is cleared in
one decision (see §5.1).

| From | To | Trigger | Guard |
|---|---|---|---|
| (none) | pending | add-task-package `--target-window` | `--target-task-id` required when `--target-window` given |
| pending | sent | record-delivery-run | delivery `readback.ok` |
| pending/sent | missing-result | reduce-results | no latest result |
| sent | completed\|blocked\|needs-review | reduce-results | maps from latest `result.status` when prior `reviewDecision != rework` |
| sent | needs-rework | reduce-results | `task.reviewDecision === 'rework'` overrides result status |
| needs-rework/missing-result | sent | prepare-dispatch + record-delivery-run | eligibility allows pending/needs-rework/missing-result |
| completed\|blocked\|needs-review (any in candidate scope) | accepted | decide accept | `decide-review` stamps `nextTaskStatus=accepted` on the **whole** candidate scope (`state.mjs:1209-1220`); not already final; `--accept-blocked` if any in-scope task is blocked |
| completed\|blocked\|needs-review (any in candidate scope) | needs-rework | decide rework | stamps `nextTaskStatus=needs-rework` + `reviewDecision=rework` on the **whole** candidate scope (so an in-scope `blocked` task also moves to `needs-rework`) |
| accepted | (refuse re-import) | import-target-result | already-accepted tasks refuse new results → create follow-up package |

### 5.3 Task package (`state.taskPackages[].status`)

```mermaid
stateDiagram-v2
  [*] --> pending : add-task-package
  pending --> accepted : decide [ALL tasks accepted]
  pending --> needs_rework : decide [ALL tasks needs-rework]
  pending --> blocked : decide [ALL tasks blocked]
  pending --> pending : decide [partial]
```

A package advances to `nextTaskStatus` only when **all** its target tasks reach
that status (`updatePackageStatusesForDecision`); otherwise unchanged.
`complete-demand` requires every package and target task `accepted`.

### 5.4 State-root window (`state.windows[].windowState`)

Inline vocabulary (no schema): `pending` → on delivery-sent `active`
(`markStateRootDeliverySent` sets `windowState='active'` for the delivered task's
window, `wakeflow-result-recording-commands.mjs:161`) → on reduce
`waiting-results` (any task missing) / `blocked-result` (any blocked) /
`result-ready` (all ready) → on decide `accepted`/`needs-rework`/`blocked` for
windows owning a candidate task.

```mermaid
stateDiagram-v2
  [*] --> pending : add-task-package
  pending --> active : record-delivery-run sent [markStateRootDeliverySent]
  active --> waiting_results : reduce [any task missing]
  active --> blocked_result : reduce [any blocked]
  active --> result_ready : reduce [all ready]
  pending --> waiting_results : reduce [any task missing]
  pending --> blocked_result : reduce [any blocked]
  pending --> result_ready : reduce [all ready]
  result_ready --> accepted : decide accept
  result_ready --> needs_rework : decide rework
  blocked_result --> blocked : decide blocked
```

### 5.5 Transition candidate, target result, delivery

```mermaid
stateDiagram-v2
  state "Transition Candidate" as TC {
    [*] --> accepting : reduce [all present, none blocked]
    [*] --> blocked_c : reduce [all present, ≥1 blocked]
    accepting --> consumed : decide-review [fromRevision==revision]
    blocked_c --> consumed : decide-review [fromRevision==revision]
  }
  state "Target Result" as TR {
    [*] --> completed : import --status completed
    [*] --> blocked_r : import --status blocked
    [*] --> needs_review : import --status needs-review
  }
  state "Delivery (out-of-state-root)" as DV {
    [*] --> pending_host_send : build/prepare-delivery [writes window lock]
    pending_host_send --> sent : record-delivery-run sent [readback.ok + evidence]
    pending_host_send --> failed : record-delivery-run failed [requires --error]
    pending_host_send --> blocked_d : record-delivery-run blocked [requires --error]
    sent --> released : record-target-result [matching deliveryId]
  }
```

| Entity | From | To | Trigger | Guard |
|---|---|---|---|---|
| Transition candidate | (none) | accepting | reduce-results | all present, none blocked; `allowedDecisions=[accept,rework,blocked]`; `fromRevision=new revision` |
| | (none) | blocked | reduce-results | all present, ≥1 blocked |
| | accepting\|blocked | (consumed/stale) | decide-review | fails if `fromRevision != current revision` |
| Target result | (none) | completed\|blocked\|needs-review | import-target-result `--status` | task exists & belongs to window; not already-accepted; demand not completed/archived; revision unchanged |
| Delivery run | (none) | pending-host-send | build/prepare-delivery | writes window lock (TTL 7200s) |
| | pending-host-send | sent | record-delivery-run `--status sent` | `readback.ok` required |
| | pending-host-send | failed\|blocked | record-delivery-run failed\|blocked | **both** failed AND blocked require `--error` (`status !== "sent" && !error.trim()` fails, `result-recording-commands.mjs:248-249`) |
| | sent | (lock released) | record-target-result / import-target-result | releases lock when result answers the locking `deliveryId` |

### 5.6 Dispatch group, controller-return, return policy

- **Dispatch group status** (`buildGroupSnapshot.groupStatus`): `waiting`,
  `pending-dispatch`, `partially-ready`, `ready`, `blocked`.
- **Controller-return delivery status for group**: `not-applicable` →
  `not-built` → `pending-host-send` → `sent` (blocks duplicate returns).
- **Return policy** (`DispatchGroup.returnPolicy.mode`): `group-ready` |
  `per-target`. There is **no explicit mode-immutability guard** in code; the
  enforcement is non-overwrite-based: an existing dispatch-group record is
  **reused and not overwritten** (the write is gated on `!existingGroup`,
  `dispatch-commands.mjs:461`); reuse **fails** if the stored state revision
  differs from the current one (`:444-445`); and a controller-return **cannot
  override** the stored `controllerWindow` (`:541-545`). (`returnPolicyModes` is
  `Object.freeze`'d at `return-policy.mjs:1`, but that freezes the enum array,
  not any per-group field.) `returnRoute`: `controller` | `none`.

### 5.7 Host ownership, lock, activity monitor (cross-references)

These three entities are detailed in §7 (host transport). In brief:

- **Demand `controllerHost`**: `null(unclaimed)` → claim-on-first-drive →
  `claude-code` | `codex`; fail-closed for the other host; transfer only via
  `adopt-demand-host`/`--adopt-host`.
- **`WakeflowWindowDeliveryLock`**: `absent` → `fresh-same-host` (advisory) /
  `fresh-other-host` (fail-closed) → released on matching result, or `expired`
  after TTL.
- **`@wakeflow_state`** (tmux per-window option, Claude only): `unset` → `busy`
  → `running` (green ` >> ` badge) → `done` (green ` +  ` badge) → `unset`.

### 5.8 Runtime/window status vocabulary (separate projection layer)

`status-machine.mjs:1-19` defines 17 values: `draft`, `pending`, `running`,
`delivered`, `review`, `blocked`, `completed`, `paused`, `cancelled`, `rejected`,
`observing`, `none`, `idle`, `maintained`, `template`, `policy`, `archive`, with
send-eligibility predicates (`isSendEligibleState` = pending\|running\|delivered;
`isNoSendState` = review\|completed\|paused\|cancelled\|rejected\|observing\|none\|idle;
`isPausedLikeState` = paused\|cancelled\|rejected\|blocked). Consumed by
next-work/archive/docs-verify only — entirely separate from the demand enum and
the inline window strings.

> **Open questions / verify:** The 14-value demand schema enum is a superset of
> the 7 reducer-written states; `idle`/`designing`/`needs-confirmation`/
> `dispatching` are neither read nor written in `wakeflow-state.mjs`, but some
> other script outside this subsystem might write `paused`/`archived` (not
> exhaustively confirmed). Demand state never becomes `accepting` (only
> `candidateState` uses it; `decide accept` jumps review-ready → planned). The
> inline `window.windowState` set has no schema to validate against.
> `automation-dispatch.schema.json` may be an aspirational contract rather than a
> validated file shape.

---

## 6. Local File Storage

Wakeflow splits storage by **what the data is, not who wrote it**. Business state
(demands, state roots, packages, results, dispatch packets/groups, delivery
envelopes/runs, ledger docs) is **host-neutral**; transport runtime (window
handles, configs, tmux bindings, keep-live, activity-monitor pid) is
**host-scoped** under `hosts/<host>/`, derived from `hostProfile.runtime.hostDirName`.

Three committed/ignored boundaries are explicit:

- **`.wakeflow-local/`** — holds **REAL session/thread ids**; **never committed**.
- **`.wakeflow-active/`** — local runtime (active docs + per-demand state roots);
  gitignored.
- **`wakeflow-ledger/`** — durable long-term records; **committed**.

The workspace `.gitignore` is forced to contain exactly `.wakeflow-active/` and
`.wakeflow-local/` (`wakeflow-setup.mjs:675` `RUNTIME_GITIGNORE_ENTRIES`); the
ledger is **not** ignored. `workspace.config.json` is tracked while
`.wakeflow-local/workspace.config.json` overrides it locally and wins
(`wakeflow-config.mjs:66-78`).

### 6.1 Annotated directory tree

```text
INSTALLED WORKSPACE LAYOUT (what Wakeflow writes locally)
Legend: [T]=tracked  [I]=gitignored/local-runtime  [L]=committed long-term ledger

<workspace>/
├── workspace.config.json                       [T] shared host-neutral truth; per-host knobs under "hosts"
├── CLAUDE.md / AGENTS.md                        [T] per-host controller gate cards (each plugin owns its file)
├── .gitignore                                   [T] forced to contain .wakeflow-active/ + .wakeflow-local/
│
├── .wakeflow-active/                           [I] SHARED business state (host-neutral, no handles)
│   └── workspace/
│       ├── index.md                                 active controller entry
│       └── current/
│           ├── index.md
│           ├── workspace-current-status.md
│           ├── global-todo-board.md
│           ├── design-handoff-board.md / -inbox.md
│           ├── test-exchange.md
│           └── <demand-slug>/                       === PER-DEMAND STATE ROOT ===
│               ├── demand.json                       [json] immutable demand record (init)
│               ├── wakeflow-state.json               [json] authoritative state machine
│               ├── controller-events.jsonl           [jsonl] append-only event log (every mutation)
│               ├── projection.json                   [json] render projection cache
│               ├── developer-progress.md             [md] human projection w/ unified-status marker block
│               ├── intake/                            Design/Test intake docs (lazy)
│               ├── test-cards/                        Test cards — machine source (lazy)
│               ├── task-packages/<id>.json            [json] one per task package
│               ├── target-results/<id>.json           [json] imported TargetResultEnvelopes
│               ├── evidence/                           evidence artifacts (lazy)
│               └── transition-candidates/<id>.json    [json] reduce-results candidates (lazy)
│
├── .wakeflow-local/                            [I] NEVER COMMITTED — holds REAL session/thread ids
│   ├── workspace.config.json                        [I] optional local override (wins over tracked config)
│   └── wakeflow-delivery/                            === stateDir default (wakeflow-delivery.mjs:26) ===
│       ├── dispatch-packets/<id>.json                [json] SHARED dispatch packets
│       ├── dispatch-groups/<id>.json                 [json] SHARED dispatch group snapshots
│       ├── delivery-envelopes/<id>.json              [json] SHARED delivery / controller-return envelopes
│       ├── delivery-runs/<id>.json                   [json] SHARED send/readback evidence
│       ├── target-results/                           [json] SHARED TargetResultEnvelopes
│       │   ├── <group>__<window>__<task>.json
│       │   └── superseded/<…>__superseded-<ts>.json  archived prior results
│       ├── locks/<window>.json                       [json] SHARED cross-host advisory delivery lock
│       ├── stop.json                                 [json] SHARED automation stop marker
│       ├── thread-registry/<window>.json             [json] LEGACY codex-only read-fallback (pre-dual-host)
│       └── hosts/<host>/                             === PER-HOST transport runtime (hostDirName) ===
│           │                                          host = "codex" | "claude-code"
│           ├── thread-registry/<window>.json         [json] window handle (threadId / session uuid)
│           ├── window-config/<window>.json           [json] derived sendability view (regenerable)
│           ├── keep-live/{state.json,control.json}   keep-live runtime state + worker control
│           ├── window-host/<window>.json             [json] claude-code ONLY: tmux binding
│           └── activity-monitor-<server>.pid         claude-code ONLY: monitor daemon pid
│
└── wakeflow-ledger/                             [L] SHARED durable records (COMMITTED long-term)
    ├── workspace/
    │   ├── workspace-record-map.md
    │   └── archive/                                  archived workspace docs (month/topic tree)
    ├── requirement-designs/
    ├── goal-stage-confirmation/
    └── <window-slug>/                                per-window long-term ledger

NOTE: this repo IS the plugin source — its own workspace.config.json / wakeflow-ledger /
.wakeflow-active are untracked dogfood runtime here (git ls-files = 0). [T]/[I]/[L]
describe the INSTALLED-workspace contract the code enforces, not this source checkout.
```

### 6.2 Per-path storage table

| Path | writtenBy | readBy | format | scope | committed |
|---|---|---|---|---|---|
| `workspace.config.json` | wakeflow-setup configure | wakeflow-config, window-runtime, claude-host | json | per-workspace | tracked (override wins locally) |
| `.wakeflow-local/workspace.config.json` | manual / setup | wakeflow-config (resolved first, wins) | json | per-workspace | **never** |
| `.wakeflow-active/index.md` + `current/*` | setup scaffold + controller edits | controller, verify-workspace-docs, check-layout | md | per-workspace | gitignored |
| `<state-root>/demand.json` | wakeflow-state init | controller orientation | json | per-demand | gitignored |
| `<state-root>/wakeflow-state.json` | wakeflow-state reducers + `markStateRootDeliverySent` (NOT import-target-result) | all reducers, render-progress, demand-sequence, delivery status scan | json | per-demand | gitignored |
| `<state-root>/controller-events.jsonl` | every mutating reducer via `appendJsonLine` (O_APPEND) | audit/trace | jsonl | per-demand | gitignored |
| `<state-root>/transition-candidates/<id>.json` | reduce-results (only when nothing missing) | decide-review (validates `fromRevision==revision`) | json | per-demand | gitignored |
| `<state-root>/target-results/<id>.json` | import-target-result (auto-timestamps on collision) | reduce-results (latest-by-createdAt), review-pack | json | per-demand | gitignored |
| `<state-root>/task-packages/<id>.json` | add-task-package | prepare-dispatch (`readTaskPackageFromStateRoot`) | json | per-demand | gitignored |
| `<state-root>/projection.json` + `developer-progress.md` | init seeds; render-progress rebuilds (reducers only flip `projection.status=stale`) | render-progress, demand-sequence, humans | json + md | per-demand | gitignored |
| `.wakeflow-local/wakeflow-delivery/dispatch-packets/<id>.json` | prepare-dispatch / build-delivery | build-delivery, review | json | per-target dispatch | never |
| `.wakeflow-local/wakeflow-delivery/dispatch-groups/<id>.json` | `upsertDispatchGroup` | review, callbackPlan, controller-return | json | per-group | never |
| `.wakeflow-local/wakeflow-delivery/delivery-envelopes/<id>.json` | build-delivery / prepare-dispatch / build-controller-return | record-delivery-run, trace-spine, host send | json | per-delivery | never |
| `.wakeflow-local/wakeflow-delivery/delivery-runs/<id>.json` | record-delivery-run | delivery-evidence (`sent` computed here), status, lock release | json | per-send-attempt | never |
| `.wakeflow-local/wakeflow-delivery/target-results/<group>__<window>__<task>.json` | delivery-script record-target-result | review-results/pack, claude-host wait-results | json | per-target-task | never |
| `.wakeflow-local/wakeflow-delivery/target-results/superseded/<…>.json` | record-target-result on supersede | audit / replay summary | json | per-target-task | never |
| `.wakeflow-local/wakeflow-delivery/locks/<window>.json` | build-delivery (`writeWindowLock`), record-delivery-run sent refresh, claude-host `performSend` | dispatch guard, release-window-lock, status freshLocks | json | per-window (cross-host) | never |
| `.wakeflow-local/wakeflow-delivery/stop.json` | `commandStopLoop` | unattended loop / status | json | per-workspace | never |
| `.wakeflow-local/wakeflow-delivery/hosts/<host>/thread-registry/<window>.json` | register-thread / replace-windows | `loadThreadRegistration`, buildWindowConfig, dispatch | json | per-window per-host | never (REAL handle; redacted in shared records) |
| `.wakeflow-local/wakeflow-delivery/hosts/<host>/window-config/<window>.json` | build-window-config | dispatch envelope build | json | per-window per-host | never (regenerable) |
| `.wakeflow-local/wakeflow-delivery/hosts/<host>/keep-live/{state,control}.json` | keep-live start/stop/worker | keep-live status, delivery status | json | per-host | never |
| `.wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/<window>.json` | claude-host launch-window | claude-host send/wait/activity-monitor; core lists as host marker | json | per-window (claude-code only) | never |
| `.wakeflow-local/wakeflow-delivery/hosts/claude-code/activity-monitor-<server>.pid` | claude-host activity-monitor | `isActivityMonitorRunning` | text (pid) | per-tmux-server (claude-code) | never |
| `.wakeflow-local/wakeflow-delivery/thread-registry/<window>.json` (LEGACY) | (not written — legacy only) | `findThreadFile` fallback when `legacyRegistryFallback` (codex=true) | json | per-window (codex legacy) | never |
| `wakeflow-ledger/` (record-map, requirement-designs, goal-stage, per-window) | controller (committed by hand) + setup scaffold | controller/Design, archive tooling | md | per-workspace long-term | **committed** |
| `CLAUDE.md` / `AGENTS.md` (root + child repos) | setup sync-root-agents / write-agents | host agent at entry | md | per-workspace + per-child | tracked |

Key facts:

- `createDeliveryStore` (`wakeflow-delivery-store.mjs:12-24`) is the **single
  registry** that names every shared subdir and the per-host subtree.
- `controller-events.jsonl` is append-only **JSONL** (O_APPEND), distinct from
  the `wakeflow-state.json` snapshot.
- **There is no `decisions/` directory anywhere** — every "decisions" grep hit is
  the `decisionsRequired` state field; controller decisions live inside
  `wakeflow-state.json` + `controller-events.jsonl` via `decide-review`.
- Idempotency keys live **inside** the records (no separate key files); replay
  detection scans existing `delivery-runs`/`target-results`.

> **Open questions / verify:** This repo is the plugin **source**, so its own
> `workspace.config.json`/`wakeflow-ledger`/`.wakeflow-active` are untracked
> dogfood runtime (git ls-files = 0); the committed/ignored semantics describe an
> installed workspace. The Codex edition's `hosts/codex/` layout was not
> re-verified line-by-line in the codex profile (high-confidence via the shared
> core derivation). Result-file naming with an empty `dispatchGroup` can yield
> `<window>__<task>.json` (no group prefix); cross-group edge collisions were not
> stress-tested.

---

## 7. Host Transport

Wakeflow has two host transports behind one host-neutral core.

### 7.1 Claude vs Codex comparison

| Aspect | CLAUDE edition | CODEX edition |
|---|---|---|
| transport script | `wakeflow-claude-host.mjs` (1557–1558 LOC) — the boundary | **NONE** (declarative only; host's own tools) |
| window model | tmux-resident interactive `claude --session-id` process; one tmux window per Wakeflow window | host app "thread" (`create_thread`); no tmux server |
| server | ONE tmux server session ("wakeflow"); controller lives in it | n/a (host manages) |
| create window | `launch-window` (tmux new-window running `claude --session-id`) | host tool `create_thread` + `set_thread_title` |
| send | tmux `load-buffer`/`paste-buffer -d` + `send-keys Enter` into pane | host tool `send_message_to_thread` |
| readback | tmux `capture-pane` tail | host thread reply |
| state glyph | `@wakeflow_state` tmux option + activity-monitor daemon | n/a |
| recover dead window | `launch-window --resume --session-id <id> --replace` | host re-opens thread |
| hostId / memory | `claude-code` / `CLAUDE.md` / `legacyRegistryFallback=false` | `codex` / `AGENTS.md` / `legacyRegistryFallback=true` |

The core asymmetry: Codex has **no** transport script — its "host tools"
(`create_thread`/`set_thread_title`/`send_message_to_thread`) are the Codex host
agent's own built-ins; Wakeflow only writes the prompt and records the run. The
Claude transport runs host binaries (tmux/claude) directly via a narrow no-shell
`execHostText` wrapper that **intentionally bypasses** the core process whitelist
(`wakeflow-claude-host.mjs:27-40`) because this helper *is* the host transport
boundary.

### 7.2 The cross-host window lock lifecycle

The lock at `.wakeflow-local/wakeflow-delivery/locks/<window>.json`
(`WakeflowWindowDeliveryLock` v1: `{windowName, host, deliveryId, createdAt, expiresAt}`,
TTL 7200s, `host = hostProfile.runtime.hostDirName`):

```mermaid
stateDiagram-v2
  [*] --> absent
  absent --> fresh_same_host : build-delivery writeWindowLock / claude performSend writeJson
  fresh_same_host --> fresh_same_host : record-delivery-run sent (refresh) / same-id re-send
  fresh_same_host --> absent : record-target-result removeWindowLock / release-lock [deliveryId matches]
  fresh_other_host --> absent : current-host dispatch attempt — FAIL CLOSED (lock left intact)
  fresh_same_host --> expired : wall clock passes expiresAt
  expired --> absent : treated as absent
```

- **Acquired** at core `build-delivery` envelope write; the Claude helper
  `performSend` **also** writes a byte-identical lock right before pasting, so a
  manual send still locks.
- **Refreshed** on `record-delivery-run status=sent`.
- **Released** by `record-target-result` only when `lock.deliveryId` matches the
  answered delivery (or lock has no `deliveryId`).
- **Fail-closed against the OTHER host** (a fresh other-host lock blocks dispatch
  unless `--force`); **advisory same-host** (only a warning, because the
  per-task sent-state guard already prevents true double-dispatch).
- **Controller-target deliveries skip the lock entirely** — a controller-return
  has no result-record release path, so a lock would never clear; deliveries to
  the controller window are notifications.

### 7.3 The activity monitor (two badges)

A **single detached poller per tmux server** owns the `@wakeflow_state` tmux
window option:

- **Single-instance** via a pidfile re-verified with `process.kill(pid,0)` AND
  `ps -o command` to guard against pid reuse (`wakeflow-claude-host.mjs:329-376`).
  `WAKEFLOW_DISABLE_MONITOR=1` suppresses auto-start; `ensureServer` rearms it on
  every server touch.
- **Running detection is dual-signal**: matches `/esc to interrupt/i` OR any
  pane-content byte change between polls (long tool calls show only a changing
  spinner/elapsed line; an idle pane is byte-stable). Poll default 1500ms.
- **Badge 1 — running** ` >> ` (solid green bg): set when a pane is mid-turn; the
  prior marker is stashed in `@wakeflow_prev_state` and restored when running
  ends.
- **Badge 2 — done** ` +  ` (green fg): a non-running window whose effective
  marker is `busy` but whose **lock file is gone** (the result landed) flips to
  `done`.
- Glyphs are rendered **per managed window** (`window-status-format` /
  `window-status-current-format`, never `-g`) so they cannot leak into the user's
  personal tmux sessions on the same default server.
- The monitor **never marks stalls and never wakes anyone** — silence judgment is
  the controller's; residual legacy `stalled` markers are migrated to `busy`/clear.

### 7.4 Host ownership (claim-on-first-drive / adopt)

Demand `controllerHost` is **claim-on-first-drive**:

```mermaid
stateDiagram-v2
  [*] --> unclaimed : init [controllerHost=null]
  unclaimed --> owned : first state-writing drive command [stamp currentHost]
  owned --> owned : same-host reducers
  owned --> FAIL_CLOSED : reducer on different host [unless --adopt-host]
  owned --> owned_by_other : adopt-demand-host / --adopt-host [transfer event; revision bump; candidates stale]
```

- `init` sets `controllerHost=null` (host-neutral; either edition may init).
- `ensureDemandHostOwnership` (`wakeflow-state.mjs:144-167`) is called with
  `claim=true` by every mutating reducer (`add-task-package` onward). On the
  first such call when owner is null it stamps `controllerHost=currentHost`
  (`claimed:'first-driving-command'`). Thereafter `owner !== currentHost`
  **fails closed** unless `--adopt-host`. `import-target-result` calls with
  `claim=false` (read-side imports never claim).
- The gate is enforced at **every** state-mutating entrypoint, not just dispatch.
  Inside `wakeflow-state.mjs` `ensureDemandHostOwnership` is invoked from
  `add-task-package` (`:608`), `reduce-results` (`:990`), `decide-review`
  (`:1180`), and `complete-demand` (`:1333`) with `claim=true`, and from
  `import-target-result` (`:821`) with `claim=false`. Outside that file, the same
  ownership check is re-applied at the dispatch gate
  (`dispatch-commands.mjs:359-360`) and at `record-delivery-run`
  (`result-recording-commands.mjs:101-103`), plus render-progress and intake. So
  nearly every state-writing command **independently re-checks ownership and
  fails closed for the other host** — claim-on-first-drive is the entry point,
  but the fail-closed wall is everywhere, not just at first claim.
  Dispatch fails at packet-build time **on purpose** so the prompt is never
  pasted before the gate trips.
- **Transfer / adopt**: `adopt-demand-host` (MCP `wakeflow_adopt_demand_host`) or
  `--adopt-host` on a state-writing command stamps the new host, records a
  `demand.host-transferred`/`demand.host-adopted` event, and bumps the revision —
  which **stales outstanding transition candidates** (re-reduce required).

### 7.5 Dead-window recovery and launch dialogs

- Recovery is **interactive resume of the SAME session id**:
  `launch-window --resume --session-id <registered id> --replace` (kills the
  stale window first). The session id is stable across resumes and stays on the
  subscription pool. Headless `claude -p --resume` is a **billed last resort**
  (from 2026-06-15 it bills the separate Agent SDK credit at API rates).
  `replace-all` instead creates **brand-new** sessions (empty context) and
  re-registers via core `replace-windows`.
- `launch-window` auto-confirms up to three boot dialogs (folder-trust,
  large-session-resume always; bypass-permissions consent **only** when
  `configMode==='bypassPermissions'`, the recorded opt-in being the prior
  consent). Default permission mode is `acceptEdits` (the safe shipped default).

> **Open questions / verify:** The Codex host tools are referenced only as
> strings — their real side effects/readback shape live in the Codex host agent
> (outside this repo); the cross-host advisory lock is the only lock the Codex
> path participates in (written by core, never by a Codex script). Done-detection
> assumes the lock is removed by `record-target-result` before the next poll; a
> manually-left-fresh lock would keep a badge `busy`. The root `CLAUDE.md`
> documents only the `send --window --prompt-file` ceremony, but the helper now
> also ships a one-step `deliver --delivery-file` that reads the envelope
> directly — the doc text is stale relative to `deliver` (code wins). No code was
> executed; all transitions are read from source.

---

## 8. Setup, Verification & Governance

### 8.1 Init flow + guards

INIT is a **four-phase dry-run-first** flow in `wakeflow-setup.mjs initialize`:

1. **Discovery** (read-only) — `initializePayload` returns `mode=discovery` and
   writes nothing unless `hasInitializeSelection()` is true (any `--repo` /
   `--use-discovered` / `--internal-design/test` / `--thread`).
2. **Selection required** — even with selection, a write requires the `--write`
   flag.
3. **Dry-run plan** — `mode:'plan'` computes the full step plan; `okItems`
   exclude reset cleanup.
4. **Apply** — `--write` applies; `okItems` include reset cleanup only here.

Guards:

- **Re-init footprint guard** (`assertInitializeWriteAllowed`): if a footprint
  exists (config + workspace index/status, `.wakeflow-local/wakeflow-delivery`,
  root + child memory blocks) and config selection is present without
  `--reset-initialization`, `--write` fails (`reInitBlocked`); a dry-run returns
  `mode:'blocked-already-initialized'`. Reset additionally fails if
  `--use-discovered` is passed or no explicit `--repo` mappings are given.
- **Thread-registration follow-up exemption**: `initialize --thread X=<id> --write`
  (with no config selection and no reset) registers a real thread id without
  re-scaffolding; ids are validated against host-profile placeholders, must be
  whitespace-free, and land only under
  `.wakeflow-local/.../hosts/<host>/thread-registry/<window>.json`, never tracked
  docs.

Apply writes: `workspace.config.json`, `.gitignore` runtime entries, the starter
active docs + ledger (record-map, requirement-designs/goal-stage READMEs, policy
docs, archive index, per-window ledger READMEs), the parent + child
`AGENTS/CLAUDE.md` managed scope cards, and per-window thread-registry +
window-config JSON.

`replace-window(s)` is the high-frequency single/group rebind path: it requires
an existing `workspace.config.json`, ≥1 `--window`, and (on `--write`) a fresh
`--thread` per window; it regenerates only the launch plan + local registry,
never the init docs.

### 8.2 `wakeflow_verify` orchestration

`wakeflow-cli verify` → `wakeflow-verify.mjs` runs:

- **Base (always 5):** `boundary`, `repository-residue`, `repo-status`,
  `script-docs`, `git diff --check`.
- **Conditional:** when `.wakeflow-active` exists, splices in
  `workspace-docs (--all-workspace)` and `current-layout`.
- **`--with-runtime`/`--strict-runtime`:** adds `runtime-residue` (blocking
  residue fails only in strict).
- **`--with-script-tests`:** adds `node --test test/*.test.mjs`.

Each check is spawned via `runSync`; PASS/FAIL is summarized and any failure sets
`process.exitCode = 1`. A legacy thread-registry migration NOTE prints when the
host's `legacyRegistryFallback` is set (informational).

**The MCP `wakeflow_verify` handler forwards only `--script-tests`** — runtime,
strict-runtime, todo, and task-package verify modes are reachable **only via the
CLI**, not via MCP.

**Stale-doc note:** `--require-todo` / `--require-task-packages` are documented in
the plugin `AGENTS.md` (and `wakeflow-setup.mjs` even regex-rewrites those legacy
lines) but are **NOT implemented** in the current orchestrator — `wakeflow-cli`
`verify` only accepts `--runtime/--with-runtime/--strict-runtime/--script-tests/--with-script-tests`. Code wins: those TODO/task-package verify modes do not exist.

A separate source-script verification path (run by `package.json` `test`, not by
`wakeflow-verify`) covers `tools/sync-core --check`, `wakeflow-validate.mjs`
(plugin artifact completeness), and `wakeflow-smoke.mjs` (live
state→delivery→result→reduce in a temp dir).

### 8.3 Intake and archive

- **Intake** (`wakeflow-intake.mjs`) is **read-only evidence attachment** with
  strong guards: `resolveStateRoot` fails if the state root lacks
  `wakeflow-state.json`, if the demand is completed/archived, or if
  `state.controllerHost` differs from this runtime's `hostDirName`.
  `design-handoff` validates the board row via
  `wakeflow-import-design-handoffs.mjs` (must be `ready`/`accepted-by-workspace`,
  with design-key provenance on linked docs) and writes
  `intake/design-handoff-<key>.json` with `forbiddenConclusions`; it never mutates
  state. `test-card` additionally refuses while demand is
  blocked/paused/review-ready/accepting/waiting-results.
- **Archive / progress**: `archive-docs` moves `current/*.md` into the ledger
  archive month/topic dir (refusing the current plan, `index.md`, dirs, non-`.md`,
  or paths outside active docs), rewrites links, and trims index rows into the
  record-map; `archive-todo` compacts completed TODO rows + old sync bullets;
  both auto-chain `archive-summaries` when `refreshSummaries` is set on the MCP
  tools. `render-progress` rewrites the single `<!-- unified-status -->` marker
  block + `projection.json` from `wakeflow-state.json` under host + revision
  (lost-update) guards.

### 8.4 Governance diagram

```mermaid
flowchart LR
  A["Agent (MCP)"] --> M["core/lib/wakeflow-mcp-tools.mjs"]
  M -->|"wakeflow_initialize_workspace"| SETUP["wakeflow-setup initialize<br/>discover → footprint guard → discovery|plan|apply|blocked<br/>apply writes config/.gitignore/active docs/ledger/scope cards/registry"]
  M -->|"wakeflow_replace_windows"| RW["replaceWindowsPayload (needs config + --window + --thread)"]
  M -->|"wakeflow_verify(scriptTests)"| V["wakeflow-cli verify → wakeflow-verify.mjs<br/>base 5 + active-docs + runtime + script-tests<br/>(NO --require-todo/--require-task-packages)"]
  M -->|"wakeflow_intake_design_handoff"| I["wakeflow-intake design-handoff<br/>host+terminal guard → validate board row → write read-only evidence"]
  M -->|"wakeflow_archive_*"| AR["archive-docs / archive-todo → auto-chain archive-summaries"]
  M -->|"wakeflow_render_progress"| RP["render-progress: unified-status block + projection.json (revision/host guarded)"]
  SYNC["tools/sync-core.mjs"] -.->|"check:core CI gate"| SETUP
```

> **Open questions / verify:** The host-profile read while mapping `core/` is the
> Codex variant; Claude-specific launch flags/entryExtras beyond the runtime
> block were not fully read. Several `wakeflow-setup.mjs` helpers (lines
> ~600–1185: scope-card builders, access profiles, internal Design/Test README
> templates) were confirmed from call sites, not transcribed body-by-body.
> `wakeflow-validate.mjs`/`wakeflow-smoke.mjs` were read only at their heads. The
> `--require-todo`/`--require-task-packages` staleness rests on the current
> orchestrator having no such handling versus `AGENTS.md` still referencing them;
> no other core script implements those modes.

---

## 9. Key File Index

| File | Role |
|---|---|
| `tools/sync-core.mjs` | The sync engine: byte-compares `core/` against both plugin targets (`Buffer.equals`), `--check` reports drift, default copies; asserts 14 host-contract files exist |
| `core/bin/wakeflow-mcp.mjs` | 3-line shim that imports `../mcp/server.cjs`; an alternate/unused entrypoint — the plugin `.mcp.json` registers `mcp/server.cjs` directly, not this shim |
| `core/mcp/server.cjs` | Hand-rolled JSON-RPC 2.0 stdio server: framing transport, protocol negotiation, `initialize`/`tools/list`/`tools/call`/`ping` |
| `core/lib/wakeflow-mcp-tools.mjs` | Tool catalog (23 handlers) — the tool → script → subcommand → args translation table; compact/verbose; host-visible prioritization |
| `core/lib/wakeflow-runtime.mjs` | Runtime dispatcher: allow-listed script Map, spawns node child, parses last JSON, builds trace/status/error/health envelope |
| `core/lib/wakeflow-process.mjs` | Central OS-process boundary: rejects shell mode; restricts commands to node/git/ps/caffeinate |
| `core/scripts/wakeflow-state.mjs` | The heart: 7 demand reducers + host-ownership guard + reduce/decide helpers; writes `wakeflow-state.json`, `controller-events.jsonl`, candidates, results, packages |
| `core/scripts/lib/wakeflow-review-scope.mjs` | Blocked-wedge recovery: only `accepted`/`reviewDecision=accept` is final; keeps blocked-but-not-accepted tasks reviewable |
| `core/scripts/lib/wakeflow-status-machine.mjs` | Separate 17-value window/runtime status vocabulary + send-eligibility predicates (projection/scheduling layer only) |
| `core/scripts/wakeflow-delivery.mjs` | Delivery-loop CLI dispatcher; `stateDir` default `.wakeflow-local/wakeflow-delivery`; owns `stop.json` |
| `core/scripts/lib/wakeflow-dispatch-commands.mjs` | `prepare-dispatch-from-state` / `build-delivery` / `build-controller-return`; eligibility + cross-host lock + idempotency guards |
| `core/scripts/lib/wakeflow-result-recording-commands.mjs` | `record-delivery-run` (the only dispatch-time state advance via `markStateRootDeliverySent`) + `record-target-result` (lock release) |
| `core/scripts/lib/wakeflow-review-commands.mjs` | `computeReviewResults` / `buildReviewPack` / `buildStateRootReviewPack`; the mixed ready+blocked never-`blocked` rule |
| `core/scripts/lib/wakeflow-delivery-store.mjs` | Single registry for the shared delivery dir map + per-host dirs; cross-host lock helpers; legacy fallback |
| `core/scripts/lib/wakeflow-config.mjs` | Config resolution (`.wakeflow-local` override wins) + ledger path derivation |
| `core/scripts/wakeflow-setup.mjs` | Init/setup orchestrator: 4-phase dry-run→apply, write guards, scope-card upsert, thread-registry registration, gitignore contract |
| `core/scripts/wakeflow-verify.mjs` | Verification orchestrator: base 5 checks + conditional active-docs/runtime/script-tests; PASS/FAIL summary |
| `core/scripts/wakeflow-cli.mjs` | CLI aggregator behind `wakeflow_status` (fan-out) and `wakeflow_verify` |
| `core/scripts/wakeflow-intake.mjs` | Read-only Design-handoff + Test-card intake with host-ownership + non-terminal guards |
| `core/scripts/wakeflow-render-progress.mjs` | Unified-status projection rebuild with revision (lost-update) + host guards |
| `core/scripts/wakeflow-next-work.mjs` | Eligibility scanner over Design/TODO boards (no state write, no dispatch) |
| `core/scripts/wakeflow-demand-sequence.mjs` | At-most-one-active claim-next runner (init + add-task + render); emits dispatch candidates, never dispatches |
| `plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs` | Claude-ONLY 1557-line tmux transport helper: launch/send/deliver/readback/wait-results/activity-monitor + window-host bindings + glyph badges |
| `plugins/*/scripts/lib/wakeflow-host-profile.mjs` | Per-edition host profile (the seam): identity, hostTools, launch, registry/keep-live — interpolated, never branched on |
| `plugins/*/scripts/lib/wakeflow-host-send-adapter.mjs` | Per-edition transport seam: Claude tmux paste vs Codex `send_message_to_thread` (byte-different) |
| `core/schemas/wakeflow-state-machine/*.json` | Schemas for state/event/candidate/result/projection/automation-dispatch (note: state enum is a superset of reducer writes) |
| `.claude-plugin/marketplace.json` | Root catalog; single `wakeflow` entry sourcing the Claude edition only |
