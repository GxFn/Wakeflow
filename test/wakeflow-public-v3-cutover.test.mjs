import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { handlers, tools } from "../core/lib/wakeflow-mcp-tools.mjs";
import {
  createWakeflowPublicV3DomainHandlers,
  refreshWakeflowActiveProjectionAfterPublicMutation,
} from "../core/scripts/lib/wakeflow-public-v3-runtime.mjs";
import {
  appendTodoRow,
  renderTodoBoard,
  scanTodoBoard,
} from "../core/scripts/lib/wakeflow-todo-service.mjs";
import {
  hostProfile as codexHostProfile,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const EXPECTED_TOOLS = Object.freeze([
  "wakeflow_status",
  "wakeflow_maintain_workspace",
  "wakeflow_replace_windows",
  "wakeflow_register_window",
  "wakeflow_create_demand",
  "wakeflow_add_task",
  "wakeflow_prepare_delivery",
  "wakeflow_record_delivery",
  "wakeflow_record_target_result",
  "wakeflow_review_pack",
  "wakeflow_reduce_results",
  "wakeflow_decide_review",
  "wakeflow_complete_demand",
  "wakeflow_continue_demand",
  "wakeflow_record_evidence",
  "wakeflow_recover_state_transition",
  "wakeflow_release_window_lock",
  "wakeflow_view",
  "wakeflow_storage_preserve",
  "wakeflow_archive",
  "wakeflow_intake_test_card",
  "wakeflow_deliver",
  "wakeflow_next_work",
  "wakeflow_claim_next",
  "wakeflow_cancel_demand",
  "wakeflow_pod_open",
  "wakeflow_pod_record",
  "wakeflow_pod_bind",
  "wakeflow_pod_plan",
  "wakeflow_prune_runtime",
  "wakeflow_verify",
]);
const DEMAND_A = "demand_11111111-1111-4111-8111-111111111111";
const DEMAND_B = "demand_22222222-2222-4222-8222-222222222222";
const DEMAND_ACTIVE = "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const artifactHandlers = createWakeflowPublicV3DomainHandlers({
  wakeflowRoot: path.resolve("plugins/codex-wakeflow"),
  hostProfile: codexHostProfile,
});

function fixture({ interfaceLanguage = "zh" } = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-public-v3-"));
  const root = path.join(base, "Program");
  mkdirSync(path.join(root, ".wakeflow-active", "current"), { recursive: true });
  for (const directory of [
    path.join(base, "wakeflow-ledger", "requirement-designs"),
    path.join(base, "wakeflow-ledger", "goal-stage-confirmation"),
    path.join(base, "wakeflow-ledger", "workspace", "archive"),
    path.join(base, "ProductA"),
    path.join(root, "Design"),
    path.join(root, "Test"),
  ]) mkdirSync(directory, { recursive: true });
  copyFileSync(
    path.resolve("test/fixtures/wakeflow-config-v3/valid-minimal.json"),
    path.join(root, "wakeflow.config.json"),
  );
  if (interfaceLanguage !== "zh") {
    const configPath = path.join(root, "wakeflow.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.program.interfaceLanguage = interfaceLanguage;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  writeFileSync(
    path.join(root, ".wakeflow-active", "current", "global-todo-board.md"),
    renderTodoBoard(),
  );
  return { base, root };
}

function todoRow(todoId) {
  return {
    ID: todoId,
    Status: "pending-claim",
    Type: "requirement",
    Priority: "P1",
    Owner: CONTROLLER_WINDOW_ID,
    "Item / Goal": `Publish ${todoId}`,
    "Affects Retest / Dispatch": "yes",
    "Dependency / Trigger": "confirmed requirement",
    "Recommended Window": CONTROLLER_WINDOW_ID,
    "Current Mount": "none",
    "Auto Claim": "yes",
    "Testing Decision": "controller-only: run bounded public-v3 tests",
    Documents: "[requirement](requirement-designs/requirement_33333333-3333-4333-8333-333333333333/01-original-plan.md)",
  };
}

function demandPublicationRequest(root, demandId, language = "zh") {
  const boardPath = path.join(root, ".wakeflow-active/current/global-todo-board.md");
  const todoId = `TODO-${demandId.slice("demand_".length, "demand_".length + 8)}`;
  appendTodoRow({ root, boardPath, row: todoRow(todoId) });
  const selected = scanTodoBoard(readFileSync(boardPath, "utf8")).rows.find(
    (entry) => entry.id === todoId,
  );
  assert.ok(selected);
  return {
    language,
    demand: {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand",
      programId: PROGRAM_ID,
      demandId,
      createdAt: "2026-08-23T01:02:03.000Z",
      title: "Public v3 Active projection refresh",
      goal: "Prove that successful authority publication refreshes generated navigation.",
      completionDefinition: "The public result keeps authority and projection freshness separate.",
      demandType: "requirement",
      source: selected.lineageRef,
      executionPlacement: { mode: "main" },
    },
    authority: null,
    initialTransition: {
      eventId: `event-public-create-${todoId}`,
      createdAt: "2026-08-23T01:02:03.000Z",
      reason: "Initialize one public v3 demand authority.",
      decisionSummary: "Publish authority first, then refresh generated Active documents.",
    },
    expectedTodoRow: selected.snapshot,
  };
}

test("the normal MCP facade exposes the exact public v3 tool set", () => {
  assert.equal(Object.isFrozen(tools), true);
  assert.deepEqual(tools.map((tool) => tool.name), EXPECTED_TOOLS);
  assert.deepEqual(Object.keys(handlers), EXPECTED_TOOLS);
  assert.equal(tools.some((tool) => tool.name === "wakeflow_initialize_workspace"), false);
  assert.equal(tools.some((tool) => tool.name === "wakeflow_adopt_demand_host"), false);
  for (const tool of tools) {
    assert.equal(Object.isFrozen(tool), true);
    assert.equal(Object.isFrozen(tool.inputSchema), true);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.doesNotMatch(JSON.stringify(tool), /v3-candidate|"candidate"\s*:\s*true/iu);
    assert.equal(typeof handlers[tool.name], "function");
  }
});

test("runtime operation admission matches every routed MCP declaration before workspace reads", async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-public-operation-"));
  const missingRoot = path.join(base, "missing-workspace");
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const routed = tools.filter((tool) => Array.isArray(tool.inputSchema?.properties?.operation?.enum));
  const operationVocabulary = new Set([
    "toString",
    "constructor",
    "hasOwnProperty",
    "not-a-wakeflow-operation",
    ...routed.flatMap((tool) => tool.inputSchema.properties.operation.enum),
  ]);

  for (const tool of routed) {
    const admitted = new Set(tool.inputSchema.properties.operation.enum);
    for (const operation of operationVocabulary) {
      await assert.rejects(
        handlers[tool.name]({ root: missingRoot, operation, request: {} }),
        (error) => (
          error?.code === "wakeflow-public-mcp-domain"
          && (admitted.has(operation)
            ? error.details?.causeCode !== "wakeflow-public-v3-operation"
            : error.details?.causeCode === "wakeflow-public-v3-operation")
        ),
        `${tool.name}:${operation}`,
      );
    }
  }
});

test("a public v3 handler derives the canonical TODO path and returns only portable authority", async (t) => {
  const { base, root } = fixture();
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const result = await handlers.wakeflow_next_work({
    root,
    operation: "inspect",
    request: {},
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.tool, "wakeflow_next_work");
  assert.equal(result.operation, "inspect");
  assert.equal(result.result.board.boardRef, ".wakeflow-active/current/global-todo-board.md");
  assert.equal(result.result.board.rowCount, 0);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(JSON.stringify(result).includes(base), false);
  assert.equal(JSON.stringify(result).includes("candidate"), false);
  assert.equal(Object.hasOwn(result, "activeProjection"), false);
});

test("public authority mutations refresh Active projections while TODO-only writes do not", async (t) => {
  const { base, root } = fixture();
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const indexPath = path.join(root, ".wakeflow-active/index.md");
  const statusPath = path.join(root, ".wakeflow-active/current/workspace-current-status.md");
  assert.equal(existsSync(indexPath), false);

  const created = await artifactHandlers.wakeflow_create_demand({
    root,
    operation: "apply",
    request: demandPublicationRequest(root, DEMAND_ACTIVE),
  });

  assert.equal(created.result.status, "published");
  assert.deepEqual(created.activeProjection, {
    kind: "WakeflowActiveProjectionRefreshReceipt",
    schemaVersion: 1,
    status: "current",
    attempted: true,
    projectionStatus: "current",
    sourceHealth: "complete",
    storageHealth: "healthy",
    writeStatus: "rebuilt",
    written: [
      ".wakeflow-active/current/workspace-current-status.md",
      ".wakeflow-active/index.md",
    ],
    issueCodes: [],
  });
  assert.equal(existsSync(indexPath), true);
  assert.equal(existsSync(statusPath), true);
  const before = [readFileSync(indexPath, "utf8"), readFileSync(statusPath, "utf8")];

  const delivered = await artifactHandlers.wakeflow_deliver({
    root,
    operation: "append",
    request: { row: todoRow("TODO-projection-independent") },
  });
  assert.equal(Object.hasOwn(delivered, "activeProjection"), false);
  assert.deepEqual(
    [readFileSync(indexPath, "utf8"), readFileSync(statusPath, "utf8")],
    before,
    "TODO authority is linked by Active Markdown but is not projector source",
  );

  const unreferencedArtifact = path.join(
    root,
    ".wakeflow-active/current",
    DEMAND_ACTIVE,
    "task-packages/unreferenced.json",
  );
  writeFileSync(unreferencedArtifact, "{}\n", { mode: 0o600 });
  const degraded = await artifactHandlers.wakeflow_recover_state_transition({
    root,
    demandId: DEMAND_ACTIVE,
    operation: "generic",
    request: {},
  });
  assert.equal(degraded.activeProjection.status, "degraded");
  assert.equal(degraded.activeProjection.sourceHealth, "complete");
  assert.equal(degraded.activeProjection.projectionStatus, "current");
  assert.equal(degraded.activeProjection.storageHealth, "degraded");
  assert.equal(degraded.activeProjection.writeStatus, "current");
});

test("auto language refresh stays honest for ordinary and evidence recovery", async (t) => {
  const { base, root } = fixture({ interfaceLanguage: "auto" });
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const created = await artifactHandlers.wakeflow_create_demand({
    root,
    operation: "apply",
    request: demandPublicationRequest(root, DEMAND_ACTIVE, "zh"),
  });
  assert.equal(created.activeProjection.status, "current");

  const generic = await artifactHandlers.wakeflow_recover_state_transition({
    root,
    demandId: DEMAND_ACTIVE,
    operation: "generic",
    request: {},
  });
  assert.deepEqual(generic.activeProjection, {
    kind: "WakeflowActiveProjectionRefreshReceipt",
    schemaVersion: 1,
    status: "deferred",
    attempted: false,
    projectionStatus: "unknown",
    sourceHealth: "unknown",
    storageHealth: "unknown",
    writeStatus: "not-attempted",
    written: [],
    issueCodes: ["active-projection-language-unresolved"],
  });

  const evidence = await handlers.wakeflow_record_evidence({
    root,
    demandId: DEMAND_ACTIVE,
    mode: "recover",
  });
  assert.deepEqual(evidence.activeProjection, generic.activeProjection);
});

test("post-commit Active refresh failures are stable data and never invoke accessors", () => {
  let accessed = false;
  const malicious = {
    workspaceRoot: path.resolve("/tmp/wakeflow-public-refresh-contract"),
    bundle: null,
  };
  Object.defineProperty(malicious, "language", {
    enumerable: true,
    get() {
      accessed = true;
      return "zh";
    },
  });
  const rejected = refreshWakeflowActiveProjectionAfterPublicMutation(malicious);
  assert.equal(accessed, false);
  assert.equal(rejected.status, "degraded");
  assert.deepEqual(rejected.issueCodes, ["active-projection-refresh-contract"]);

  const failed = refreshWakeflowActiveProjectionAfterPublicMutation({
    workspaceRoot: path.resolve("/tmp/wakeflow-public-refresh-missing"),
    bundle: null,
    language: "zh",
  });
  assert.equal(failed.status, "degraded");
  assert.equal(failed.attempted, true);
  assert.equal(failed.writeStatus, "failed");
  assert.deepEqual(failed.issueCodes, ["active-projection-refresh-failed"]);
  assert.equal(Object.isFrozen(failed), true);
});

test("storage preservation inspection receives the complete derived program authority", async (t) => {
  const { base, root } = fixture();
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const result = await handlers.wakeflow_storage_preserve({
    root,
    operation: "inspect",
    request: {},
  });

  assert.equal(result.tool, "wakeflow_storage_preserve");
  assert.equal(result.operation, "inspect");
  assert.equal(result.result.status, "missing");
  assert.match(result.result.programId, /^program_/u);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(JSON.stringify(result).includes(base), false);
});

test("the public envelope rejects caller-owned derived fields and legacy config authority", async (t) => {
  const { base, root } = fixture();
  t.after(() => rmSync(base, { recursive: true, force: true }));

  for (const current of [
    {
      tool: "wakeflow_next_work",
      args: {
        root,
        operation: "inspect",
        request: { boardPath: path.join(root, ".wakeflow-active/current/global-todo-board.md") },
      },
    },
    {
      tool: "wakeflow_deliver",
      args: { root, operation: "append", request: { root } },
    },
    {
      tool: "wakeflow_archive",
      args: {
        root,
        demandId: DEMAND_A,
        operation: "preview",
        request: { demandId: DEMAND_B },
      },
    },
    {
      tool: "wakeflow_complete_demand",
      args: {
        root,
        demandId: DEMAND_A,
        operation: "preview",
        request: { action: "cancel" },
      },
    },
  ]) {
    await assert.rejects(
      handlers[current.tool](current.args),
      (error) => (
        error?.code === "wakeflow-public-mcp-domain"
        && error.details?.causeCode === "wakeflow-public-v3-derived-field"
        && !error.message.includes(root)
      ),
      current.tool,
    );
  }

  for (const current of [
    {
      tool: "wakeflow_replace_windows",
      args: { root, operation: "inspect", request: { unexpected: true } },
    },
    {
      tool: "wakeflow_create_demand",
      args: {
        root,
        demandId: DEMAND_A,
        operation: "recover",
        request: { unexpected: true },
      },
    },
  ]) {
    await assert.rejects(
      handlers[current.tool](current.args),
      (error) => (
        error?.code === "wakeflow-public-mcp-domain"
        && error.details?.causeCode === "wakeflow-public-v3-contract"
      ),
      current.tool,
    );
  }

  const configPath = path.join(root, "wakeflow.config.json");
  const legacyConfig = {
    workspaceName: "Legacy",
    controllerWindow: "Wakeflow",
    repositories: [],
  };
  writeFileSync(configPath, `${JSON.stringify(legacyConfig, null, 2)}\n`);
  await assert.rejects(
    handlers.wakeflow_next_work({ root, operation: "inspect", request: {} }),
    (error) => (
      error?.code === "wakeflow-public-mcp-domain"
      && error.details?.causeCode === "wakeflow-public-v3-config"
      && !JSON.stringify(error).includes(root)
    ),
  );

  assert.doesNotMatch(readFileSync(configPath, "utf8"), /schemaVersion\s*:\s*3/u);
});
