import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
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
import { fileURLToPath } from "node:url";

import { tools as publicTools } from "../core/lib/wakeflow-mcp-tools.mjs";
import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  handlers as artifactHandlers,
  tools as artifactTools,
} from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  repository: "repository_33333333-3333-4333-8333-333333333333",
  designSurface: "surface_44444444-4444-4444-8444-444444444444",
  testSurface: "surface_55555555-5555-4555-8555-555555555555",
  controllerWindow: "window_66666666-6666-4666-8666-666666666666",
  designWindow: "window_77777777-7777-4777-8777-777777777777",
  testWindow: "window_88888888-8888-4888-8888-888888888888",
  productWindow: "window_99999999-9999-4999-8999-999999999999",
});
const CREATED_AT = "2026-08-10T00:00:00.000Z";

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function config() {
  return {
    $schema: "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json",
    kind: "WakeflowConfig",
    schemaVersion: 3,
    program: {
      programId: IDS.program,
      displayName: "Public Evidence MCP",
      interfaceLanguage: "en",
    },
    topology: {
      repositories: [{
        repositoryId: IDS.repository,
        path: "../ProductA",
        displayName: "Product A",
        instructionManagement: "owner-managed",
      }],
      supportSurfaces: [{
        surfaceId: IDS.designSurface,
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        surfaceId: IDS.testSurface,
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{
        windowId: IDS.controllerWindow,
        role: "controller",
        displayName: "Controller",
        root: { kind: "program" },
      }, {
        windowId: IDS.designWindow,
        role: "design",
        displayName: "Design",
        root: { kind: "support-surface", surfaceId: IDS.designSurface },
      }, {
        windowId: IDS.testWindow,
        role: "test",
        displayName: "Test",
        root: { kind: "support-surface", surfaceId: IDS.testSurface },
      }, {
        windowId: IDS.productWindow,
        role: "product",
        displayName: "Product A",
        root: { kind: "repository", repositoryId: IDS.repository },
      }],
    },
    storage: { ledgerRoot: "../Ledger" },
    governance: {},
    hosts: {},
  };
}

function fixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-evidence-mcp-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Program");
  const stateRoot = path.join(root, ".wakeflow-active/current", IDS.demand);
  for (const directory of [
    root,
    path.join(base, "ProductA"),
    path.join(base, "Ledger"),
    path.join(root, "Design"),
    path.join(root, "Test"),
    stateRoot,
    path.join(stateRoot, "task-packages"),
    path.join(stateRoot, "target-results"),
    path.join(stateRoot, "review-candidates"),
    path.join(stateRoot, "test-cards"),
    path.join(stateRoot, "evidence"),
    path.join(stateRoot, "transactions"),
  ]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeCanonical(path.join(root, "wakeflow.config.json"), config());
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "Evidence MCP fixture",
    goal: "Record one locator as immutable managed evidence.",
    completionDefinition: "The exact evidence ref is selected by current state.",
    demandType: "requirement",
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-todo-lineage-ref",
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-T09-EVIDENCE",
      intakeRowDigest: `sha256:${"a".repeat(64)}`,
    },
    executionPlacement: { mode: "main" },
  };
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-initial-evidence-mcp-0001",
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: "Initialize the evidence MCP fixture.",
    decisionSummary: "Publish an empty evidence capability without a fabricated fact.",
    changedArtifacts: [{
      artifactKind: "wakeflow-demand",
      ref: "demand.json",
      digest: canonicalJsonDigest(demand),
    }],
  };
  const state = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    revision: 1,
    state: "intake",
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    taskPackages: [],
    targetTasks: [],
    targetResults: [],
    testCards: [],
    evidence: [],
    review: {
      status: "idle",
      readyTargetTaskIds: [],
      blockedTargetTaskIds: [],
      missingTargetTaskIds: [],
    },
  };
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(path.join(stateRoot, "controller-events.jsonl"), `${canonicalJson(event)}\n`, { mode: 0o600 });
  return { root, stateRoot };
}

test("public v3 exposes the evidence and maintenance owners in the exact 31-tool artifact", () => {
  assert.equal(publicTools.length, 31);
  assert.deepEqual(artifactTools.map((tool) => tool.name), publicTools.map((tool) => tool.name));
  assert.deepEqual(Object.keys(artifactHandlers), artifactTools.map((tool) => tool.name));
  assert.equal(artifactTools.some((tool) => tool.name === "wakeflow_maintain_workspace"), true);
  assert.equal(artifactTools.some((tool) => tool.name === "wakeflow_record_evidence"), true);
  assert.equal(artifactTools.some((tool) => tool.name === "wakeflow_initialize_workspace"), false);
  for (const tool of artifactTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
  const evidence = artifactTools.find((tool) => tool.name === "wakeflow_record_evidence");
  const serialized = JSON.stringify(evidence.inputSchema);
  for (const forbidden of ["actorRole", "recordedBy", "userConfirmed", "stateRoot", "configPath", "controllerWindowId"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("public evidence handler derives Controller authority and uses the exact M2 plan/apply path", async (t) => {
  const current = fixture(t);
  const beforeState = readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8");
  const source = {
    kind: "https",
    url: "https://example.invalid/wakeflow/t09-report",
    verification: {
      kind: "caller-supplied-digest",
      digest: digestBytes("reviewed locator\n"),
    },
  };
  const preview = await artifactHandlers.wakeflow_record_evidence({
    root: current.root,
    demandId: IDS.demand,
    mode: "preview",
    kind: "test-output",
    source,
    relations: [],
    sensitivity: "internal",
    controllerReviewedOpaque: false,
  });
  assert.equal(preview.tool, "wakeflow_record_evidence");
  assert.equal(Object.hasOwn(preview, "candidate"), false);
  assert.equal(preview.mode, "preview");
  assert.equal(preview.result.plan.controllerWindowId, IDS.controllerWindow);
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(Object.hasOwn(preview, "activeProjection"), false);
  assert.equal(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8"), beforeState);
  assert.equal(JSON.stringify(preview).includes(current.root), false);

  const applied = await artifactHandlers.wakeflow_record_evidence({
    root: current.root,
    demandId: IDS.demand,
    mode: "apply",
    plan: preview.result.plan,
    planDigest: preview.result.planDigest,
  });
  assert.equal(applied.result.status, "recorded");
  assert.equal(Object.isFrozen(applied), true);
  assert.equal(applied.activeProjection.status, "current");
  assert.equal(applied.activeProjection.attempted, true);
  assert.equal(applied.activeProjection.writeStatus, "rebuilt");
  assert.equal(existsSync(path.join(current.stateRoot, applied.result.ref)), true);
  assert.equal(JSON.parse(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8")).revision, 2);

  const replay = await artifactHandlers.wakeflow_record_evidence({
    root: current.root,
    demandId: IDS.demand,
    mode: "apply",
    plan: preview.result.plan,
    planDigest: preview.result.planDigest,
  });
  assert.equal(replay.result.status, "already-recorded");
  assert.equal(replay.activeProjection.status, "current");
  assert.equal(replay.activeProjection.writeStatus, "current");
  await assert.rejects(
    () => artifactHandlers.wakeflow_record_evidence({
      root: current.root,
      demandId: IDS.demand,
      mode: "preview",
      kind: "test-output",
      source,
      relations: [{ kind: "invented-relation", privatePath: current.root }],
    }),
    (error) => error?.code === "wakeflow-public-mcp-evidence"
      && typeof error?.details?.causeCode === "string"
      && !JSON.stringify({ message: error.message, details: error.details }).includes(current.root),
  );

  const secondPreview = await artifactHandlers.wakeflow_record_evidence({
    root: current.root,
    demandId: IDS.demand,
    mode: "preview",
    kind: "test-output",
    source: {
      ...source,
      url: "https://example.invalid/wakeflow/t09-stale-report",
    },
  });
  const driftedConfig = config();
  driftedConfig.topology.windows[0].windowId = "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  writeCanonical(path.join(current.root, "wakeflow.config.json"), driftedConfig);
  await assert.rejects(
    () => artifactHandlers.wakeflow_record_evidence({
      root: current.root,
      demandId: IDS.demand,
      mode: "apply",
      plan: secondPreview.result.plan,
      planDigest: secondPreview.result.planDigest,
    }),
    (error) => error?.code === "wakeflow-public-mcp-evidence"
      && typeof error?.details?.causeCode === "string"
      && !JSON.stringify({ message: error.message, details: error.details }).includes(current.root),
  );
  assert.equal(JSON.parse(readFileSync(path.join(current.stateRoot, "wakeflow-state.json"), "utf8")).revision, 2);
  const recovery = await artifactHandlers.wakeflow_record_evidence({
    root: current.root,
    demandId: IDS.demand,
    mode: "recover",
  });
  assert.equal(recovery.mode, "recover");
  assert.equal(Object.hasOwn(recovery, "activeProjection"), true);
  assert.equal(Object.isFrozen(recovery), true);
  assert.equal(JSON.stringify(recovery).includes(current.root), false);
  await assert.rejects(
    () => artifactHandlers.wakeflow_record_evidence({
      root: current.root,
      demandId: IDS.demand,
      mode: "preview",
      kind: "test-output",
      source,
      actorRole: "controller",
    }),
    /field|contract|unknown/iu,
  );
});

test("public Codex artifact maintenance handler loads lazily and previews without writing", async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-public-mcp-maintenance-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "Program");
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(path.join(base, "ProductA"), { mode: 0o755 });
  const freshSelection = {
    program: { displayName: "Public MCP", interfaceLanguage: "en" },
    topology: {
      repositories: [{
        selectionKey: "product-a",
        path: "../ProductA",
        displayName: "Product A",
        instructionManagement: "owner-managed",
      }],
      supportSurfaces: [{
        selectionKey: "design",
        capability: "design",
        path: "Design",
        displayName: "Design",
        ownership: "wakeflow-managed",
      }, {
        selectionKey: "test",
        capability: "test",
        path: "Test",
        displayName: "Test",
        ownership: "wakeflow-managed",
      }],
      windows: [{ role: "controller", displayName: "Controller", root: { kind: "program" } },
        { role: "design", displayName: "Design", root: { kind: "support-surface", selectionKey: "design" } },
        { role: "test", displayName: "Test", root: { kind: "support-surface", selectionKey: "test" } },
        { role: "product", displayName: "Product A", root: { kind: "repository", selectionKey: "product-a" } }],
    },
    storage: { ledgerRoot: "../wakeflow-ledger" },
    governance: {},
    hosts: {},
  };
  const result = await artifactHandlers.wakeflow_maintain_workspace({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: freshSelection, language: "en" },
  });
  assert.equal(result.tool, "wakeflow_maintain_workspace");
  assert.equal(result.result.status, "ready", JSON.stringify(result.result.blockers));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(existsSync(path.join(root, "wakeflow.config.json")), false);
  assert.equal(JSON.stringify(result).includes(repositoryRoot), false);
  assert.equal(JSON.stringify(result).includes(root), false);
  await assert.rejects(
    () => artifactHandlers.wakeflow_maintain_workspace({
      root,
      action: "reset",
      mode: "preview",
      request: {},
    }),
    (error) => error?.code === "wakeflow-public-mcp-maintenance"
      && error?.details?.causeCode === "wakeflow-maintenance-invalid-action"
      && !JSON.stringify({ message: error.message, details: error.details }).includes(root),
  );

  const executable = path.join(
    repositoryRoot,
    "plugins/codex-wakeflow/scripts/wakeflow-setup.mjs",
  );
  const direct = spawnSync(
    process.execPath,
    [executable, "--request-stdin", "--json"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        root,
        action: "fresh-initialize",
        mode: "preview",
        request: { selection: freshSelection, language: "en" },
      }),
      shell: false,
    },
  );
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  assert.equal(direct.stderr, "");
  const directResult = JSON.parse(direct.stdout);
  assert.equal(directResult.ok, true);
  assert.equal(directResult.tool, "wakeflow_maintain_workspace");
  assert.equal(directResult.result.status, "ready");
  assert.equal(direct.stdout.includes(root), false);
});
