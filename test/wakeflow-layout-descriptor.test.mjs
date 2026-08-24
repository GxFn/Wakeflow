import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixtureRoot = path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3");

function fixture(name = "valid-minimal.json") {
  return JSON.parse(readFileSync(path.join(fixtureRoot, name), "utf8"));
}

async function model(name = "valid-minimal.json") {
  const { parseWakeflowConfigV3 } = await import("../core/scripts/lib/wakeflow-config-v3.mjs");
  return parseWakeflowConfigV3(fixture(name));
}

test("layout descriptor separates fresh static roots from event-only facts", async () => {
  const {
    createWakeflowLayoutDescriptor,
    eventOnlyWakeflowLayoutEntries,
    freshWakeflowLayoutEntries,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: codexProfile });
  assert.equal(descriptor.kind, "WakeflowLayoutDescriptor");
  assert.equal(wakeflowLayoutEntry(descriptor, "workspace.config").path, "wakeflow.config.json");
  assert.equal(wakeflowLayoutEntry(descriptor, "active.root").path, ".wakeflow-active");
  assert.equal(wakeflowLayoutEntry(descriptor, "active.root").owner, "layout-manager");
  assert.equal(wakeflowLayoutEntry(descriptor, "active.current").owner, "layout-manager");
  assert.equal(wakeflowLayoutEntry(descriptor, "local.root").path, ".wakeflow-local");
  assert.equal(wakeflowLayoutEntry(descriptor, "local.root").mode, "0700");
  assert.equal(
    wakeflowLayoutEntry(descriptor, "local.shared.transport.demands").path,
    ".wakeflow-local/runtime/shared/transport/demands",
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "local.shared.coordination.window-leases").path,
    ".wakeflow-local/runtime/shared/coordination/window-leases",
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "local.audit.preserved").path,
    ".wakeflow-local/audit/preserved",
  );
  const fresh = freshWakeflowLayoutEntries(descriptor);
  const events = eventOnlyWakeflowLayoutEntries(descriptor);
  assert.ok(fresh.every((entry) => entry.createTiming !== "event-only"));
  assert.ok(events.every((entry) => entry.createTiming === "event-only"));
  assert.ok(events.some((entry) => entry.key === "event.identity.binding"));
  assert.ok(events.some((entry) => entry.key === "event.transport.group"));
  assert.ok(events.some((entry) => entry.key === "event.demand.target-result"));
  assert.ok(events.some((entry) => entry.key === "event.demand.transaction.archive"));
  assert.ok(events.some((entry) => entry.key === "event.demand.archive.intent"));
  assert.ok(events.some((entry) => entry.key === "event.demand.archive.tombstone"));
  assert.ok(events.some((entry) => entry.key === "event.active.projector.lock"));
  assert.deepEqual(
    descriptor.entries.filter((entry) => entry.owner === "wakeflow"),
    [],
    "每个布局表面都必须声明真实 owner，不能回退到泛化 Wakeflow owner",
  );
  const allPaths = descriptor.entries.map((entry) => entry.path).join("\n");
  for (const forbidden of [
    ".wakeflow-local/wakeflow-delivery",
    ".wakeflow-local/wakeflow-delivery/target-results",
    "window-ledger",
    "next-work.json",
    "README.md",
  ]) {
    assert.equal(allPaths.includes(forbidden), false, `${forbidden} is not a v3 layout surface`);
  }
});

test("event-only descriptor owns the complete confirmed protocol path table", async () => {
  const {
    createWakeflowLayoutDescriptor,
    eventOnlyWakeflowLayoutEntries,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: claudeProfile });
  const actual = new Map(eventOnlyWakeflowLayoutEntries(descriptor).map((entry) => [entry.key, {
    path: entry.path,
    pathKind: entry.pathKind,
  }]));
  // 这是独立于生产 builder 的完整协议清单。新增或删除任何 event path 都必须在
  // review 中显式修改此表，避免测试只抽查若干已知 key 却声称覆盖完整布局。
  const expected = {
    "event.active.projector.lock": [".wakeflow-active/projector.lock", "file"],
    "event.maintenance.lock": [".wakeflow-local/runtime/maintenance.lock", "file"],
    "event.maintenance.lock-publisher-stage": [".wakeflow-local/runtime/.wakeflow-publish.lock.{operationId}.{generation}.{platform}.{pid}.{startIdentity}.{nonce}.stage", "file"],
    "event.maintenance.transaction": [".wakeflow-local/runtime/maintenance/transactions/{operationId}.json", "file"],
    "event.maintenance.publisher-stage": [".wakeflow-local/runtime/maintenance/transactions/.wakeflow-publish.{artifactKind}.{operationId}.{generation}.{platform}.{pid}.{startIdentity}.{nonce}.stage", "file"],
    "event.maintenance.transaction-stage": [".wakeflow-local/runtime/maintenance/transactions/.{operationId}.{generation}.checkpoint-stage", "file"],
    "event.maintenance.recovery-claim": [".wakeflow-local/runtime/maintenance/transactions/{operationId}.recovery-{generation}.json", "file"],
    "event.transport.demand.groups": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/groups", "directory"],
    "event.transport.demand.packets": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/packets", "directory"],
    "event.transport.demand.envelopes": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/envelopes", "directory"],
    "event.transport.demand.runs": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/runs", "directory"],
    "event.transport.group": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/groups/{groupId}.json", "file"],
    "event.transport.packet": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/packets/{packetId}.json", "file"],
    "event.transport.envelope": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/envelopes/{deliveryId}.json", "file"],
    "event.transport.run": [".wakeflow-local/runtime/shared/transport/demands/{demandId}/runs/{runId}.json", "file"],
    "event.coordination.window-lease": [".wakeflow-local/runtime/shared/coordination/window-leases/{windowId}.json", "file"],
    "event.audit.manager-lock": [".wakeflow-local/audit/manager.lock", "file"],
    "event.audit.preservation.root": [".wakeflow-local/audit/preserved/{preservationId}", "directory"],
    "event.audit.preservation": [".wakeflow-local/audit/preserved/{preservationId}/preservation.json", "file"],
    "event.audit.preservation.payload": [".wakeflow-local/audit/preserved/{preservationId}/payload", "directory"],
    "event.demand.publication.identity-lock": [".wakeflow-active/current.identity-lock", "file"],
    "event.demand.publication.intent": [".wakeflow-active/current/{demandId}.create-intent.json", "file"],
    "event.demand.publication.stage": [".wakeflow-active/current/.wakeflow-create-stage-{demandId}", "directory"],
    "event.demand.publication.create-lock": [".wakeflow-active/current/{demandId}.create-lock", "file"],
    "event.demand.transition.state-lock": [".wakeflow-active/current/{demandId}.state-lock", "file"],
    "event.demand.root": [".wakeflow-active/current/{demandId}", "directory"],
    "event.demand.identity": [".wakeflow-active/current/{demandId}/demand.json", "file"],
    "event.demand.authority": [".wakeflow-active/current/{demandId}/demand-authority.json", "file"],
    "event.demand.state": [".wakeflow-active/current/{demandId}/wakeflow-state.json", "file"],
    "event.demand.controller-events": [".wakeflow-active/current/{demandId}/controller-events.jsonl", "file"],
    "event.demand.index": [".wakeflow-active/current/{demandId}/index.md", "file"],
    "event.demand.progress": [".wakeflow-active/current/{demandId}/developer-progress.md", "file"],
    "event.demand.task-packages.root": [".wakeflow-active/current/{demandId}/task-packages", "directory"],
    "event.demand.target-results.root": [".wakeflow-active/current/{demandId}/target-results", "directory"],
    "event.demand.review-candidates.root": [".wakeflow-active/current/{demandId}/review-candidates", "directory"],
    "event.demand.test-cards.root": [".wakeflow-active/current/{demandId}/test-cards", "directory"],
    "event.demand.evidence.root": [".wakeflow-active/current/{demandId}/evidence", "directory"],
    "event.demand.transactions.root": [".wakeflow-active/current/{demandId}/transactions", "directory"],
    "event.demand.pod.root": [".wakeflow-active/current/{demandId}/pod", "directory"],
    "event.demand.pod.design-requests.root": [".wakeflow-active/current/{demandId}/pod/design-requests", "directory"],
    "event.demand.pod.design-handoffs.root": [".wakeflow-active/current/{demandId}/pod/design-handoffs", "directory"],
    "event.demand.task-package": [".wakeflow-active/current/{demandId}/task-packages/{taskPackageId}.json", "file"],
    "event.demand.target-results.target-task-root": [".wakeflow-active/current/{demandId}/target-results/{targetTaskId}", "directory"],
    "event.demand.target-result": [".wakeflow-active/current/{demandId}/target-results/{targetTaskId}/{targetResultId}.json", "file"],
    "event.demand.review-candidate": [".wakeflow-active/current/{demandId}/review-candidates/{candidateId}.json", "file"],
    "event.demand.test-card": [".wakeflow-active/current/{demandId}/test-cards/{testCardId}.json", "file"],
    "event.demand.evidence.stage": [".wakeflow-active/current/{demandId}/evidence/.{evidenceId}.wakeflow-stage", "directory"],
    "event.demand.evidence.artifact-root": [".wakeflow-active/current/{demandId}/evidence/{evidenceId}", "directory"],
    "event.demand.evidence.manifest": [".wakeflow-active/current/{demandId}/evidence/{evidenceId}/evidence.json", "file"],
    "event.demand.evidence.payload": [".wakeflow-active/current/{demandId}/evidence/{evidenceId}/payload", "directory"],
    "event.demand.transaction.create": [".wakeflow-active/current/{demandId}/transactions/create.json", "file"],
    "event.demand.transaction.state-transition": [".wakeflow-active/current/{demandId}/transactions/state-transition.json", "file"],
    "event.demand.transaction.archive": [".wakeflow-active/current/{demandId}/transactions/archive.json", "file"],
    "event.demand.archive.intent": [".wakeflow-active/current/.{demandId}.wakeflow-archive-intent.json", "file"],
    "event.demand.archive.tombstone": [".wakeflow-active/current/.{demandId}.wakeflow-archive-stage", "directory"],
    "event.demand.pod.design-request": [".wakeflow-active/current/{demandId}/pod/design-requests/{requestId}.json", "file"],
    "event.demand.pod.design-handoff": [".wakeflow-active/current/{demandId}/pod/design-handoffs/{handoffId}.json", "file"],
    "event.identity.binding": [".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings/{windowId}.json", "file"],
    "event.pod.root": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}", "directory"],
    "event.pod.scope": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/pod-scope.json", "file"],
    "event.pod.binding.creation-receipt": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/bindings/{windowId}/creation-receipt.json", "file"],
    "event.pod.binding.resume-observation": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/bindings/{windowId}/resume-observations/{observationId}.json", "file"],
    "event.pod.test-access.plan": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/test-access/{probeId}/plan.json", "file"],
    "event.pod.test-access.receipt": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/test-access/{probeId}/receipt.json", "file"],
    "event.pod.close.intent": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/close/{closeOperationId}/intent.json", "file"],
    "event.pod.close.receipt": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/close/{closeOperationId}/receipt.json", "file"],
    "event.pod.launch-intent": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/launch-intents/{launchOperationId}.json", "file"],
    "event.pod.materialization": [".wakeflow-local/runtime/hosts/claude-code/evidence/pods/{podId}/materialization/{launchOperationId}/events/{eventId}.json", "file"],
    "event.keep-live.lease": [".wakeflow-local/runtime/hosts/claude-code/operations/keep-live/leases/{automationRunId}.json", "file"],
    "event.keep-live.process": [".wakeflow-local/runtime/hosts/claude-code/operations/keep-live/process.json", "file"],
    "event.keep-live.control": [".wakeflow-local/runtime/hosts/claude-code/operations/keep-live/control.json", "file"],
    "event.keep-live.manager-lock": [".wakeflow-local/runtime/hosts/claude-code/operations/keep-live/manager.lock", "file"],
    "event.host.locator": [".wakeflow-local/runtime/hosts/claude-code/operations/window-locators/{windowId}.json", "file"],
    "event.host.locator-lock": [".wakeflow-local/runtime/hosts/claude-code/operations/window-locators/{windowId}.lock", "file"],
    "event.host.activity-process": [".wakeflow-local/runtime/hosts/claude-code/operations/activity-monitor/{serverContextId}/process.json", "file"],
    "event.host.activity-manager-lock": [".wakeflow-local/runtime/hosts/claude-code/operations/activity-monitor/{serverContextId}/manager.lock", "file"],
    "event.host.temp-prompt": [".wakeflow-local/runtime/hosts/claude-code/operations/temp/prompts/{operationId}.txt", "file"],
    "event.ledger.requirement.root": ["../wakeflow-ledger/requirement-designs/{requirementId}", "directory"],
    "event.ledger.requirement.record": ["../wakeflow-ledger/requirement-designs/{requirementId}/record.json", "file"],
    "event.ledger.requirement.document": ["../wakeflow-ledger/requirement-designs/{requirementId}/{documentPath}", "file"],
    "event.ledger.confirmation.root": ["../wakeflow-ledger/goal-stage-confirmation/{confirmationId}", "directory"],
    "event.ledger.confirmation.record": ["../wakeflow-ledger/goal-stage-confirmation/{confirmationId}/record.json", "file"],
    "event.ledger.confirmation.document": ["../wakeflow-ledger/goal-stage-confirmation/{confirmationId}/{documentPath}", "file"],
    "event.ledger.archive.root": ["../wakeflow-ledger/workspace/archive/{yearMonth}/{archiveId}", "directory"],
    "event.ledger.archive.manifest": ["../wakeflow-ledger/workspace/archive/{yearMonth}/{archiveId}/archive-manifest.json", "file"],
    "event.ledger.archive.payload": ["../wakeflow-ledger/workspace/archive/{yearMonth}/{archiveId}/{memberPath}", "file"],
  };
  assert.deepEqual(
    [...actual.keys()].sort(),
    Object.keys(expected).sort(),
    "event-only descriptor 与完整协议清单必须双向闭合",
  );
  for (const [key, [eventPath, pathKind]] of Object.entries(expected)) {
    assert.deepEqual(actual.get(key), { path: eventPath, pathKind }, `${key} must have one canonical descriptor path`);
  }
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.transaction.create").owner,
    "demand-publication-service",
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.transaction.state-transition").owner,
    "state-transaction-manager",
  );
  for (const key of [
    "event.demand.publication.identity-lock",
    "event.demand.publication.intent",
    "event.demand.publication.stage",
    "event.demand.publication.create-lock",
  ]) {
    assert.equal(wakeflowLayoutEntry(descriptor, key).owner, "demand-publication-service");
  }
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.transition.state-lock").owner,
    "state-transaction-manager",
  );
  assert.deepEqual(
    {
      owner: wakeflowLayoutEntry(descriptor, "event.active.projector.lock").owner,
      authority: wakeflowLayoutEntry(descriptor, "event.active.projector.lock").authority,
      lifecycle: wakeflowLayoutEntry(descriptor, "event.active.projector.lock").lifecycle,
      mode: wakeflowLayoutEntry(descriptor, "event.active.projector.lock").mode,
      createTiming: wakeflowLayoutEntry(descriptor, "event.active.projector.lock").createTiming,
      tracking: wakeflowLayoutEntry(descriptor, "event.active.projector.lock").tracking,
    },
    {
      owner: "active-projector",
      authority: "mutation-admission",
      lifecycle: "ephemeral-lock",
      mode: "0600",
      createTiming: "event-only",
      tracking: "ignored",
    },
  );
  assert.deepEqual(
    [
      "event.demand.publication.identity-lock",
      "event.demand.publication.create-lock",
      "event.demand.transition.state-lock",
    ].map((key) => wakeflowLayoutEntry(descriptor, key).lifecycle),
    ["ephemeral-lock", "ephemeral-lock", "ephemeral-lock"],
  );
  assert.deepEqual(
    [
      "event.demand.publication.intent",
      "event.demand.transaction.create",
      "event.demand.transaction.state-transition",
      "event.demand.transaction.archive",
      "event.demand.archive.intent",
    ].map((key) => wakeflowLayoutEntry(descriptor, key).lifecycle),
    [
      "incomplete-transaction-journal",
      "incomplete-transaction-journal",
      "incomplete-transaction-journal",
      "incomplete-transaction-journal",
      "incomplete-transaction-journal",
    ],
  );
  for (const key of [
    "event.demand.transaction.archive",
    "event.demand.archive.intent",
    "event.demand.archive.tombstone",
  ]) {
    assert.equal(wakeflowLayoutEntry(descriptor, key).owner, "archive-service");
    assert.equal(wakeflowLayoutEntry(descriptor, key).createTiming, "event-only");
  }
  assert.deepEqual(
    {
      authority: wakeflowLayoutEntry(descriptor, "event.demand.archive.tombstone").authority,
      lifecycle: wakeflowLayoutEntry(descriptor, "event.demand.archive.tombstone").lifecycle,
      mode: wakeflowLayoutEntry(descriptor, "event.demand.archive.tombstone").mode,
    },
    {
      authority: "none",
      lifecycle: "incomplete-transaction-tombstone",
      mode: "0700",
    },
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.publication.stage").authority,
    "none",
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.publication.stage").lifecycle,
    "transaction-staging-residue",
  );
  assert.deepEqual(
    {
      owner: wakeflowLayoutEntry(descriptor, "event.demand.evidence.stage").owner,
      authority: wakeflowLayoutEntry(descriptor, "event.demand.evidence.stage").authority,
      lifecycle: wakeflowLayoutEntry(descriptor, "event.demand.evidence.stage").lifecycle,
    },
    {
      owner: "evidence-importer",
      authority: "none",
      lifecycle: "transaction-staging-residue",
    },
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.evidence.artifact-root").authority,
    "managed-evidence",
  );
});

test("demand descriptor consumes the exact leaf roots and protects every demand path mode", async () => {
  const {
    createWakeflowLayoutDescriptor,
    eventOnlyWakeflowLayoutEntries,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const {
    wakeflowDemandCapabilityRoots,
    WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_RECOVERY_ROOT,
  } = await import("../core/scripts/lib/wakeflow-demand-layout.mjs");
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: codexProfile });

  assert.deepEqual(wakeflowDemandCapabilityRoots({ mode: "main" }), [
    ...WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_RECOVERY_ROOT,
  ]);
  const isolatedLeaves = wakeflowDemandCapabilityRoots({ mode: "isolated" });
  assert.deepEqual(isolatedLeaves, [
    ...WAKEFLOW_DEMAND_COMMON_CAPABILITY_ROOTS,
    WAKEFLOW_DEMAND_RECOVERY_ROOT,
    ...WAKEFLOW_DEMAND_ISOLATED_CAPABILITY_ROOTS,
  ]);

  const expectedDirectories = new Set();
  for (const leaf of isolatedLeaves) {
    const segments = leaf.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  assert.equal(wakeflowLayoutEntry(descriptor, "event.demand.root").mode, "0700");
  for (const relative of expectedDirectories) {
    const key = `event.demand.${relative.replaceAll("/", ".")}.root`;
    const entry = wakeflowLayoutEntry(descriptor, key);
    assert.equal(entry?.path, `.wakeflow-active/current/{demandId}/${relative}`, `${key} path`);
    assert.equal(entry?.pathKind, "directory", `${key} kind`);
    assert.equal(entry?.mode, "0700", `${key} mode`);
  }

  const demandEvents = eventOnlyWakeflowLayoutEntries(descriptor)
    .filter((entry) => entry.key.startsWith("event.demand."));
  assert.ok(demandEvents.length > expectedDirectories.size);
  for (const entry of demandEvents) {
    assert.equal(
      entry.mode,
      entry.pathKind === "directory" ? "0700" : "0600",
      `${entry.key} must use the demand-private mode`,
    );
  }
});

test("Codex and Claude share one host-neutral digest while only applicable host surfaces differ", async () => {
  const { createWakeflowLayoutDescriptor } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const parsed = await model();
  const codex = createWakeflowLayoutDescriptor({ model: parsed, hostProfile: codexProfile });
  const claude = createWakeflowLayoutDescriptor({ model: parsed, hostProfile: claudeProfile });
  assert.equal(codex.configDigest, claude.configDigest);
  assert.equal(codex.hostNeutralDigest, claude.hostNeutralDigest);
  assert.notEqual(codex.layoutDigest, claude.layoutDigest);
  const codexPaths = codex.entries.map((entry) => entry.path);
  const claudePaths = claude.entries.map((entry) => entry.path);
  assert.equal(codexPaths.some((entry) => entry.startsWith(".claude/")), false);
  assert.ok(claudePaths.includes(".claude/settings.json"));
  assert.ok(claudePaths.includes(".claude/settings.local.json"));
  assert.ok(claudePaths.includes(".wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs"));
  assert.equal(codexPaths.some((entry) => entry.includes("window-locators")), false);
  assert.ok(claudePaths.some((entry) => entry.includes("window-locators")));
  assert.equal(codexPaths.includes("Design/.gitignore"), false);
  assert.equal(codexPaths.includes("../ProductA/.gitignore"), false);
});

test("non-applicable identity capability contributes no descriptor surface", async () => {
  const {
    createWakeflowLayoutDescriptor,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const profile = structuredClone(codexProfile);
  profile.capabilities.identity = { applicable: false, realization: "not-applicable" };
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: profile });

  assert.equal(wakeflowLayoutEntry(descriptor, "local.host.identity"), null);
  assert.equal(wakeflowLayoutEntry(descriptor, "event.identity.binding"), null);
  assert.equal(
    descriptor.entries.some((entry) => entry.path.includes("identity/window-bindings")),
    false,
  );
});

test("host-local descriptor entries expose their unique producer ownership", async () => {
  const { createWakeflowLayoutDescriptor } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: claudeProfile });
  const entries = descriptor.entries;
  const ownerOf = (key) => entries.find((entry) => entry.key === key)?.owner;
  const expectOwner = (owner, keys) => {
    for (const key of keys) assert.equal(ownerOf(key), owner, `${key} must be owned by ${owner}`);
  };

  expectOwner("layout-manager", ["local.host.root"]);
  expectOwner("window-registration-service", ["local.host.identity", "event.identity.binding"]);
  expectOwner("runtime-projection-builder", [
    "local.host.projections.window-runtime",
    ...entries
      .filter((entry) => entry.key.startsWith("local.host.projections.window-runtime."))
      .map((entry) => entry.key),
  ]);
  expectOwner("core-pod-service", [
    "local.host.evidence.pods",
    ...entries.filter((entry) => entry.key.startsWith("event.pod.")).map((entry) => entry.key),
  ]);
  expectOwner("keep-live-manager", [
    "local.host.operations.keep-live",
    "local.host.operations.keep-live.leases",
    ...entries.filter((entry) => entry.key.startsWith("event.keep-live.")).map((entry) => entry.key),
  ]);
  expectOwner("host-lifecycle-adapter", [
    "local.host.operations.window-locators",
    "event.host.locator",
    "event.host.locator-lock",
  ]);
  expectOwner("host-settings-assets-owner", [
    "local.host.operations.assets",
    "local.host.operations.assets.statusline",
  ]);
  expectOwner("activity-monitor-manager", [
    "local.host.operations.activity-monitor",
    "event.host.activity-process",
    "event.host.activity-manager-lock",
  ]);
  expectOwner("secure-temp-operation-owner", [
    "local.host.operations.temp.prompts",
    "event.host.temp-prompt",
  ]);

  assert.deepEqual(
    entries.filter((entry) => entry.scope === "current-host" && entry.owner === "wakeflow"),
    [],
    "host-local business entries must never fall back to the generic Wakeflow owner",
  );
});

test("support and product layout follows ownership without crossing the product authorization fence", async () => {
  const {
    createWakeflowLayoutDescriptor,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const internal = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: claudeProfile });
  const designId = internal.modelRefs.supportSurfaces.design;
  const testId = internal.modelRefs.supportSurfaces.test;
  assert.equal(wakeflowLayoutEntry(internal, `support.${designId}.drafts`).path, "Design/drafts");
  assert.equal(wakeflowLayoutEntry(internal, `support.${testId}.harnesses`).path, "Test/harnesses");
  assert.equal(wakeflowLayoutEntry(internal, `support.${testId}.fixtures`).path, "Test/fixtures");
  assert.equal(wakeflowLayoutEntry(internal, `support.${designId}.settings.portable`).path, "Design/.claude/settings.json");
  assert.equal(wakeflowLayoutEntry(internal, `support.${designId}.settings.portable`).condition, null);
  assert.equal(
    wakeflowLayoutEntry(internal, `support.${designId}.settings.local`).condition,
    "local-settings-ignore-proven",
  );
  assert.equal(
    wakeflowLayoutEntry(internal, `support.${designId}.gitignore`).capability,
    "settings",
  );

  const external = createWakeflowLayoutDescriptor({ model: await model("valid-full.json"), hostProfile: claudeProfile });
  const externalDesignId = external.modelRefs.supportSurfaces.design;
  const externalTestId = external.modelRefs.supportSurfaces.test;
  assert.equal(wakeflowLayoutEntry(external, `support.${externalDesignId}.memory`).createTiming, "conditional");
  assert.equal(wakeflowLayoutEntry(external, `support.${externalDesignId}.drafts`), null);
  assert.equal(wakeflowLayoutEntry(external, `support.${externalDesignId}.settings.portable`), null);
  assert.equal(wakeflowLayoutEntry(external, `support.${externalTestId}.memory`), null);
  const repositoryId = external.modelRefs.repositories[0];
  assert.equal(wakeflowLayoutEntry(external, `repository.${repositoryId}.memory`).condition, "instruction-management-managed-block");
  assert.equal(
    wakeflowLayoutEntry(external, `repository.${repositoryId}.settings.portable`).condition,
    "explicit-product-host-surface-authorization",
  );
  assert.equal(
    wakeflowLayoutEntry(external, `repository.${repositoryId}.settings.local`).condition,
    "explicit-product-host-surface-authorization+local-settings-ignore-proven",
  );
});

test("environment validation requires an exact root and rejects overlap or symlinks without writing", async (t) => {
  const {
    createWakeflowLayoutDescriptor,
    validateWakeflowLayoutPlacements,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const temporaryRoots = [];
  const temporaryRoot = (prefix) => {
    const result = mkdtempSync(path.join(os.tmpdir(), prefix));
    temporaryRoots.push(result);
    return result;
  };
  t.after(() => {
    for (const candidate of temporaryRoots.reverse()) {
      rmSync(candidate, { recursive: true, force: true });
    }
  });

  const root = temporaryRoot("wakeflow-layout-v3-");
  const before = readdirSync(root);
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: codexProfile });
  for (const invalidRoot of [
    ".",
    ` ${root}`,
    `${root}${path.sep}.`,
  ]) {
    assert.throws(
      () => validateWakeflowLayoutPlacements({ workspaceRoot: invalidRoot, descriptor }),
      (error) => error.code === "wakeflow-layout-workspace" && error.path === "$workspaceRoot",
      `${JSON.stringify(invalidRoot)} must not be normalized silently`,
    );
  }
  const validation = validateWakeflowLayoutPlacements({ workspaceRoot: root, descriptor });
  assert.equal(validation.ok, true);
  assert.deepEqual(readdirSync(root), before, "validation is read-only");

  const outside = temporaryRoot("wakeflow-layout-outside-");
  symlinkSync(outside, path.join(root, "Design"), "dir");
  assert.throws(
    () => validateWakeflowLayoutPlacements({ workspaceRoot: root, descriptor }),
    (error) => error.code === "wakeflow-layout-symlink" && error.path.includes("surface_"),
  );

  const overlapValue = fixture();
  overlapValue.topology.supportSurfaces[1].path = "../ProductA";
  const { parseWakeflowConfigV3 } = await import("../core/scripts/lib/wakeflow-config-v3.mjs");
  const overlap = createWakeflowLayoutDescriptor({
    model: parseWakeflowConfigV3(overlapValue),
    hostProfile: codexProfile,
  });
  assert.throws(
    () => validateWakeflowLayoutPlacements({ workspaceRoot: root, descriptor: overlap }),
    (error) => error.code === "wakeflow-layout-overlap",
  );

  const danglingRoot = temporaryRoot("wakeflow-layout-dangling-");
  symlinkSync(path.join(danglingRoot, "missing-target"), path.join(danglingRoot, "Design"), "dir");
  const danglingBefore = readdirSync(danglingRoot);
  assert.throws(
    () => validateWakeflowLayoutPlacements({ workspaceRoot: danglingRoot, descriptor }),
    (error) => error.code === "wakeflow-layout-symlink" && error.path.includes("surface_"),
  );
  assert.deepEqual(readdirSync(danglingRoot), danglingBefore);

  const intermediateRoot = temporaryRoot("wakeflow-layout-intermediate-");
  const intermediateOutside = temporaryRoot("wakeflow-layout-intermediate-outside-");
  mkdirSync(path.join(intermediateOutside, "nested"));
  symlinkSync(intermediateOutside, path.join(intermediateRoot, "Design"), "dir");
  const intermediateValue = fixture();
  intermediateValue.topology.supportSurfaces[0].path = "Design/nested";
  const intermediateDescriptor = createWakeflowLayoutDescriptor({
    model: parseWakeflowConfigV3(intermediateValue),
    hostProfile: codexProfile,
  });
  assert.throws(
    () => validateWakeflowLayoutPlacements({ workspaceRoot: intermediateRoot, descriptor: intermediateDescriptor }),
    (error) => error.code === "wakeflow-layout-symlink" && error.path.includes("surface_"),
  );
});

test("the descriptor owns v3 placement while retired document and storage adapters are absent", async () => {
  const {
    createWakeflowLayoutDescriptor,
    wakeflowLayoutEntry,
  } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const descriptor = createWakeflowLayoutDescriptor({ model: await model(), hostProfile: codexProfile });
  assert.equal(
    wakeflowLayoutEntry(descriptor, "ledger.requirements").path,
    "../wakeflow-ledger/requirement-designs",
  );
  assert.equal(
    wakeflowLayoutEntry(descriptor, "ledger.goal-stage").path,
    "../wakeflow-ledger/goal-stage-confirmation",
  );
  for (const relative of [
    "core/scripts/lib/wakeflow-document-placement.mjs",
    "core/scripts/lib/wakeflow-storage-map.mjs",
  ]) assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
});

test("shared layout source consumes profile capabilities and has no host-name behavior branch", async () => {
  await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const source = readFileSync(
    path.join(repositoryRoot, "core/scripts/lib/wakeflow-layout-descriptor.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /hostId\s*===\s*["'](?:codex|claude-code)["']/);
  assert.doesNotMatch(source, /switch\s*\(\s*hostId\s*\)/);
});
